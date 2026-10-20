// Independent, single-file modules keep the official plugin runtime dependency-free.
type Group = 'fills' | 'strokes' | 'radii' | 'effects' | 'layout';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Reference = { id: string; key: string; remote: boolean };
type Lookup = { kind: 'variable' | 'style'; ref: Reference };
type RecipeGroup = { values: Record<string, Json>; bindings: Record<string, Reference>; style?: Reference };
type StyleClass = { id: string; name: string; createdAt: number; updatedAt: number; groups: Partial<Record<Group, RecipeGroup>> };
type Database = { schemaVersion: 1; classes: StyleClass[] };
type Access = SceneNode & Record<string, unknown>;
const GROUPS: Group[] = ['fills', 'strokes', 'radii', 'effects', 'layout'];
const FIELDS: Record<Group, string[]> = {
  fills: ['fills'],
  strokes: ['strokes', 'strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeAlign', 'dashPattern', 'strokeCap', 'strokeJoin', 'strokeMiterLimit'],
  radii: ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerSmoothing'],
  effects: ['effects'],
  layout: ['layoutMode', 'layoutWrap', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'counterAxisAlignContent', 'itemReverseZIndex', 'strokesIncludedInLayout'],
};
const BINDABLE = new Set(['strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing']);
const STYLE_FIELDS: Partial<Record<Group, string>> = { fills: 'fillStyleId', strokes: 'strokeStyleId', effects: 'effectStyleId' };
type LayoutNode = FrameNode | ComponentNode | ComponentSetNode | InstanceNode;
const hasLayout = (node: SceneNode): node is LayoutNode => node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE';
const messageOf = (e: unknown): string => e instanceof Error ? e.message : String(e);

// Serialization module: references are encoded deliberately, never JSON-stringify API objects.
const Serialization = {
  reference(id: string, kind: Lookup['kind'], lookups: Lookup[]): Reference {
    const ref = { id, key: '', remote: false };
    lookups.push({ kind, ref });
    return ref;
  },
  encode(value: unknown, lookups: Lookup[]): Json {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(v => Serialization.encode(v, lookups));
    if (typeof value !== 'object' || value === null) throw new Error('Mixed or unsupported property value.');
    const object = value as Record<string, unknown>;
    if (object.type === 'VARIABLE_ALIAS' && typeof object.id === 'string') {
      return { $variable: Serialization.reference(object.id, 'variable', lookups) };
    }
    const result: Record<string, Json> = {};
    for (const key of Object.keys(object)) {
      if (object[key] !== undefined) result[key] = Serialization.encode(object[key], lookups);
    }
    return result;
  },
  async enrich(lookups: Lookup[], warnings: Set<string>): Promise<void> {
    if (!lookups.length) return;
    const results = new Map<string, { key: string; remote: boolean }>();
    const pending = new Map<string, Promise<void>>();
    for (const { kind, ref } of lookups) {
      const key = kind + ':' + ref.id;
      if (pending.has(key)) continue;
      pending.set(key, (async () => {
        try {
          const found = kind === 'variable' ? await figma.variables.getVariableByIdAsync(ref.id) : await figma.getStyleByIdAsync(ref.id);
          if (found) results.set(key, { key: found.key, remote: found.remote });
        } catch { /* Optional metadata must not prevent saving IDs and literal values. */ }
      })());
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // One budget for the entire capture, not one delay per repeated binding.
      await Promise.race([Promise.all(pending.values()), new Promise<void>(resolve => { timer = setTimeout(resolve, 2500); })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
    for (const { kind, ref } of lookups) {
      const metadata = results.get(kind + ':' + ref.id);
      if (metadata) { ref.key = metadata.key; ref.remote = metadata.remote; }
      else warnings.add('Some reference metadata was unavailable. Bindings and styles were saved by ID for this document; published-key recovery may be unavailable.');
    }
    // Late API completions only touch the private results map, never saved recipes.
  },
  async variable(ref: Reference): Promise<Variable | null> {
    try { const found = await figma.variables.getVariableByIdAsync(ref.id); if (found) return found; } catch { /* Try published key. */ }
    if (ref.remote && ref.key) { try { return await figma.variables.importVariableByKeyAsync(ref.key); } catch { /* Fallback. */ } }
    return null;
  },
  async decode(value: Json, warnings: Set<string>): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(v => Serialization.decode(v, warnings)));
    if (typeof value !== 'object' || value === null) return value;
    if ('$variable' in value) {
      const variable = await Serialization.variable(value.$variable as Reference);
      if (!variable) { warnings.add('Missing variables: saved literal values used.'); return undefined; }
      return figma.variables.createVariableAlias(variable);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const decoded = await Serialization.decode(value[key], warnings);
      if (decoded !== undefined) result[key] = decoded;
    }
    return result;
  },
  async style(ref: Reference): Promise<BaseStyle | null> {
    try { const found = await figma.getStyleByIdAsync(ref.id); if (found) return found; } catch { /* Try key. */ }
    if (ref.remote && ref.key) { try { return await figma.importStyleByKeyAsync(ref.key); } catch { /* Fallback. */ } }
    return null;
  },
};

// Storage module: versioned document-scoped envelope. No client storage or backend.
const DocumentStorage = {
  key: 'style_classes_v1',
  read(): Database {
    const raw = figma.root.getPluginData(DocumentStorage.key);
    if (!raw) return { schemaVersion: 1, classes: [] };
    const db = JSON.parse(raw) as Database;
    if (db.schemaVersion !== 1 || !Array.isArray(db.classes) || db.classes.some(c => !c || typeof c.id !== 'string' || typeof c.name !== 'string' || !c.groups || Object.keys(c.groups).some(g => !GROUPS.includes(g as Group)))) {
      throw new Error('Saved classes use an unsupported or damaged format. Existing data was not changed.');
    }
    return db;
  },
  write(db: Database): void {
    const raw = JSON.stringify(db);
    if (raw.length > 80000) throw new Error('Document class storage is full. Remove a class or use a smaller recipe.');
    figma.root.setPluginData(DocumentStorage.key, raw);
  },
};

// Capture module: explicit allowlists exclude dimensions, child sizing, and structure.
const Capture = {
  supported(node: SceneNode, group: Group): boolean {
    if (node.type === 'TEXT' && group === 'fills' && ('fills' in node && node.fills === figma.mixed)) return false;
    if (group === 'layout') return hasLayout(node) && node.layoutMode !== 'GRID';
    return FIELDS[group].some(field => field in node && (node as Access)[field] !== figma.mixed);
  },
  group(node: SceneNode, group: Group, lookups: Lookup[]): RecipeGroup {
    const n = node as Access;
    const result: RecipeGroup = { values: {}, bindings: {} };
    const bindings = n.boundVariables as Record<string, VariableAlias> | undefined;
    for (const field of FIELDS[group]) {
      const value = n[field];
      if (value === undefined || value === figma.mixed) continue;
      // Advanced paints requiring external source objects are explicitly unsupported.
      if ((field === 'fills' || field === 'strokes') && Array.isArray(value) && value.some(p => p.type === 'SHADER' || p.type === 'VIDEO')) throw new Error('Shader and video paints are not supported in this MVP.');
      if (field === 'effects' && Array.isArray(value) && value.some(e => e.type === 'SHADER')) throw new Error('Shader effects are not supported in this MVP.');
      result.values[field] = Serialization.encode(value, lookups);
      const alias = bindings?.[field];
      if (BINDABLE.has(field) && alias?.type === 'VARIABLE_ALIAS') {
        result.bindings[field] = Serialization.reference(alias.id, 'variable', lookups);
      }
    }
    const styleField = STYLE_FIELDS[group];
    const id = styleField ? n[styleField] : null;
    if (typeof id === 'string' && id) {
      result.style = Serialization.reference(id, 'style', lookups);
    }
    return result;
  },
  async recipe(node: SceneNode, groups: Group[], warnings = new Set<string>()): Promise<Partial<Record<Group, RecipeGroup>>> {
    const result: Partial<Record<Group, RecipeGroup>> = {};
    const lookups: Lookup[] = [];
    for (const group of groups) {
      if (!Capture.supported(node, group)) throw new Error('Selected layer does not support ' + group + '.');
      result[group] = Capture.group(node, group, lookups);
    }
    await Serialization.enrich(lookups, warnings);
    return result;
  },
};

// Application module: independent groups; no replacing, detaching, or reparenting.
const Application = {
  async style(node: SceneNode, group: Group, id: string): Promise<void> {
    if (group === 'fills' && 'setFillStyleIdAsync' in node) await node.setFillStyleIdAsync(id);
    if (group === 'strokes' && 'setStrokeStyleIdAsync' in node) await node.setStrokeStyleIdAsync(id);
    if (group === 'effects' && 'setEffectStyleIdAsync' in node) await node.setEffectStyleIdAsync(id);
  },
  async paints(paints: Paint[], warnings: Set<string>): Promise<Paint[]> {
    for (let i = 0; i < paints.length; i++) {
      const paint = paints[i];
      if (paint.type === 'IMAGE' && paint.imageHash && !figma.getImageByHash(paint.imageHash)) throw new Error('An image used by this class is no longer available.');
      if (paint.type === 'PATTERN' && !await figma.getNodeByIdAsync(paint.sourceNodeId)) throw new Error('The pattern source layer is no longer available.');
      if (paint.type === 'SOLID' && paint.boundVariables?.color) {
        const variable = await figma.variables.getVariableByIdAsync(paint.boundVariables.color.id);
        if (variable) paints[i] = figma.variables.setBoundVariableForPaint(paint, 'color', variable);
        else warnings.add('Missing variables: saved literal values used.');
      }
    }
    return paints;
  },
  async group(node: SceneNode, group: Group, recipe: RecipeGroup, warnings: Set<string>): Promise<void> {
    const n = node as Access;
    if (!Capture.supported(node, group)) throw new Error('Unsupported ' + group + ' on ' + node.name);
    if (group === 'layout' && hasLayout(node) && node.layoutMode !== 'NONE' && (node.primaryAxisSizingMode === 'AUTO' || node.counterAxisSizingMode === 'AUTO')) throw new Error('Auto Layout skipped on hug-sized frames to preserve sizing.');
    if (group === 'strokes' && hasLayout(node) && node.layoutMode !== 'NONE' && node.strokesIncludedInLayout && (node.primaryAxisSizingMode === 'AUTO' || node.counterAxisSizingMode === 'AUTO')) throw new Error('Strokes skipped where they would resize a hug-sized frame.');
    if (node.type === 'TEXT') {
      if (node.hasMissingFont) throw new Error('Missing fonts on ' + node.name);
      for (const font of node.getRangeAllFontNames(0, node.characters.length)) await figma.loadFontAsync(font);
    }
    const width = node.width, height = node.height;
    const dimensionBindings = group === 'layout' ? { width: node.boundVariables?.width, height: node.boundVariables?.height } : {};
    const values: Record<string, unknown> = {};
    for (const field of Object.keys(recipe.values)) values[field] = await Serialization.decode(recipe.values[field], warnings);
    if (values.fills) values.fills = await Application.paints(values.fills as Paint[], warnings);
    if (values.strokes) values.strokes = await Application.paints(values.strokes as Paint[], warnings);
    if (Array.isArray(values.effects)) {
      const effects = values.effects as Effect[];
      for (let i = 0; i < effects.length; i++) {
        const effect = effects[i];
        if (!('boundVariables' in effect) || !effect.boundVariables) continue;
        for (const field of Object.keys(effect.boundVariables) as VariableBindableEffectField[]) {
          const alias = (effect.boundVariables as Partial<Record<VariableBindableEffectField, VariableAlias>>)[field];
          if (alias) { const variable = await figma.variables.getVariableByIdAsync(alias.id); if (variable) effects[i] = figma.variables.setBoundVariableForEffect(effects[i], field, variable); }
        }
      }
    }
    // Detach only this group's old style; restore linkage last so it remains native.
    await Application.style(node, group, '');
    for (const field of FIELDS[group]) {
      if (!(field in node) || !(field in values)) continue;
      if (BINDABLE.has(field)) node.setBoundVariable(field as VariableBindableNodeField, null);
      if (field === 'fills' && 'setFillsAsync' in node) await node.setFillsAsync(values[field] as Paint[]);
      else if (field === 'strokes' && 'setStrokesAsync' in node) await node.setStrokesAsync(values[field] as Paint[]);
      else n[field] = values[field];
    }
    for (const field of Object.keys(recipe.bindings)) {
      if (!(field in node) || !BINDABLE.has(field)) continue;
      const variable = await Serialization.variable(recipe.bindings[field]);
      if (variable) node.setBoundVariable(field as VariableBindableNodeField, variable);
      else warnings.add('Missing variables: saved literal values used.');
    }
    if (recipe.style) {
      const style = await Serialization.style(recipe.style);
      if (style) await Application.style(node, group, style.id);
      else warnings.add('Missing styles: saved properties used instead.');
    }
    if (group === 'layout' && hasLayout(node)) {
      // Never copy HUG/FILL, layoutGrow, constraints, min/max, width or height.
      node.primaryAxisSizingMode = 'FIXED';
      node.counterAxisSizingMode = 'FIXED';
      if (node.width !== width || node.height !== height) node.resizeWithoutConstraints(width, height);
      for (const field of ['width', 'height'] as const) {
        const alias = dimensionBindings[field];
        if (alias) {
          const variable = await figma.variables.getVariableByIdAsync(alias.id);
          if (variable) node.setBoundVariable(field, variable);
        }
      }
    }
  },
};

function editable(node: SceneNode): boolean {
  let ancestor: BaseNode | null = node;
  while (ancestor && ancestor.type !== 'PAGE' && ancestor.type !== 'DOCUMENT') {
    if ('locked' in ancestor && ancestor.locked) return false;
    if (ancestor.type === 'INSTANCE' && ancestor !== node) return false;
    ancestor = ancestor.parent;
  }
  return GROUPS.some(group => Capture.supported(node, group));
}
function pushState(): void {
  try {
    const selection = figma.currentPage.selection;
    const available = selection.filter(editable);
    const source = selection.length === 1 && available.length === 1 ? available[0] : null;
    figma.ui.postMessage({ type: 'state', classes: DocumentStorage.read().classes.map(c => ({ id: c.id, name: c.name, groups: Object.keys(c.groups) })), count: available.length, total: selection.length, source: source?.name ?? null, groups: source ? GROUPS.filter(g => Capture.supported(source, g)) : [] });
  } catch (error) { figma.ui.postMessage({ type: 'feedback', error: true, text: messageOf(error) }); }
}
type Message = { type: string; requestId?: string; id?: string; name?: string; groups?: Group[] };
let busy = false;
// Custom plugins are namespaced by the host; the manifest UUID is not the routing ID.
figma.showUI(__html__.replace('"__STYLE_STACKS_RUNTIME_ID__"', JSON.stringify(figma.pluginId ?? '')), { width: 340, height: 580, themeColors: true });
figma.root.setRelaunchData({ 'bfc5a14b-b1c2-4cbe-85e2-4173cdd491c8': 'Style Stacks' });
figma.on('selectionchange', pushState);
figma.ui.onmessage = async (msg: Message) => {
  if (msg.type === 'ready') { pushState(); return; }
  if (busy) { figma.ui.postMessage({ type: 'feedback', requestId: msg.requestId, error: true, text: 'Another action is still running. Please wait before retrying.' }); return; }
  busy = true;
  const warnings = new Set<string>();
  try {
    const db = DocumentStorage.read();
    const index = db.classes.findIndex(c => c.id === msg.id);
    const existing = db.classes[index];
    let text = '';
    if (msg.type === 'save' || msg.type === 'update') {
      const selection = figma.currentPage.selection;
      if (selection.length !== 1 || !editable(selection[0])) throw new Error('Select one editable, compatible layer.');
      const groups = msg.type === 'update' && existing ? Object.keys(existing.groups) as Group[] : [...new Set(msg.groups ?? [])].filter(g => GROUPS.includes(g));
      if (!groups.length) throw new Error('Choose at least one property group.');
      if (msg.type === 'update' && !existing) throw new Error('Class no longer exists.');
      const name = msg.type === 'update' ? existing.name : (msg.name ?? '').trim();
      if (!name || name.length > 80) throw new Error('Enter a class name of 1–80 characters.');
      if (db.classes.some(c => c.id !== existing?.id && c.name.toLowerCase() === name.toLowerCase())) throw new Error('A class with that name already exists.');
      const groupsData = await Capture.recipe(selection[0], groups, warnings);
      // Metadata resolution yields to other plugin instances. Merge into fresh storage.
      const latest = DocumentStorage.read();
      const currentIndex = latest.classes.findIndex(c => c.id === existing?.id);
      if (msg.type === 'update' && (currentIndex < 0 || JSON.stringify(latest.classes[currentIndex]) !== JSON.stringify(existing))) throw new Error('Class changed while capturing. Try updating again.');
      if (latest.classes.some(c => (msg.type !== 'update' || c.id !== existing.id) && c.name.toLowerCase() === name.toLowerCase())) throw new Error('A class with that name already exists.');
      const now = Date.now();
      const result: StyleClass = { id: existing?.id ?? now.toString(36) + Math.random().toString(36).slice(2, 9), name, groups: groupsData, createdAt: existing?.createdAt ?? now, updatedAt: now };
      if (msg.type === 'update') latest.classes[currentIndex] = result; else latest.classes.push(result);
      DocumentStorage.write(latest);
      text = msg.type === 'update' ? 'Class updated. Previously styled layers are unchanged.' : 'Saved “' + name + '”.';
    } else if (msg.type === 'rename') {
      if (!existing) throw new Error('Class no longer exists.');
      const name = (msg.name ?? '').trim();
      if (!name || name.length > 80) throw new Error('Enter a class name of 1–80 characters.');
      if (db.classes.some(c => c.id !== existing.id && c.name.toLowerCase() === name.toLowerCase())) throw new Error('A class with that name already exists.');
      existing.name = name; existing.updatedAt = Date.now(); DocumentStorage.write(db); text = 'Class renamed.';
    } else if (msg.type === 'delete') {
      if (!existing) throw new Error('Class no longer exists.');
      db.classes.splice(index, 1); DocumentStorage.write(db); text = 'Class deleted.';
    } else if (msg.type === 'apply') {
      if (!existing) throw new Error('Class no longer exists.');
      const selection = [...figma.currentPage.selection];
      if (!selection.length) throw new Error('Select a compatible layer.');
      let applied = 0;
      for (const node of selection) {
        if (!editable(node)) { warnings.add('Locked or unsupported layers were skipped.'); continue; }
        let changed = false;
        for (const group of GROUPS) {
          const recipe = existing.groups[group];
          if (!recipe) continue;
          if (!Capture.supported(node, group)) { warnings.add(group + ' skipped on incompatible layers.'); continue; }
          // Snapshot each group so a rejected API write cannot leave it half-applied.
          try {
            if (group === 'layout' && hasLayout(node) && node.layoutMode !== 'NONE' && (node.primaryAxisSizingMode === 'AUTO' || node.counterAxisSizingMode === 'AUTO')) {
              warnings.add('Auto Layout skipped on hug-sized frames to preserve sizing.');
              continue;
            }
            if (group === 'strokes' && hasLayout(node) && node.layoutMode !== 'NONE' && node.strokesIncludedInLayout && (node.primaryAxisSizingMode === 'AUTO' || node.counterAxisSizingMode === 'AUTO')) {
              warnings.add('Strokes skipped where they would resize a hug-sized frame.');
              continue;
            }
            const before = (await Capture.recipe(node, [group]))[group]!;
            try { await Application.group(node, group, recipe, warnings); changed = true; }
            catch (error) {
              try { await Application.group(node, group, before, new Set<string>()); } catch { warnings.add('Could not fully restore a rejected group.'); }
              warnings.add(messageOf(error));
            }
          } catch (error) { warnings.add(messageOf(error)); }
        }
        if (changed) applied++;
      }
      if (!applied) throw new Error([...warnings].join(' ') || 'No compatible property groups in the selection.');
      text = 'Applied “' + existing.name + '” to ' + applied + (applied === 1 ? ' layer.' : ' layers.');
    } else { throw new Error('Unknown action.'); }
    figma.ui.postMessage({ type: 'feedback', requestId: msg.requestId, error: false, saved: msg.type === 'save', text: text + (warnings.size ? ' ' + [...warnings].join(' ') : '') });
  } catch (error) { figma.ui.postMessage({ type: 'feedback', requestId: msg.requestId, error: true, text: messageOf(error) }); }
  finally { busy = false; pushState(); }
};

async function watchDocument(): Promise<void> {
  // Dynamic-page access requires all pages to finish loading before this listener.
  // Keep the UI and action handler available while document loading is pending.
  await figma.loadAllPagesAsync();
  figma.on('documentchange', () => { if (!busy) pushState(); });
  pushState();
}

void watchDocument().catch((error: unknown) => {
  figma.ui.postMessage({ type: 'feedback', error: true, text: 'Automatic refresh is unavailable. Selection changes and class actions still refresh the panel. ' + messageOf(error) });
});
