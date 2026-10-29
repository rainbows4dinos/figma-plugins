// Independent, single-file modules keep the official plugin runtime dependency-free.
type Group = 'fills' | 'strokes' | 'radii' | 'effects' | 'layout';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
// `name` is the variable or style name at capture time: lets exporters read a recipe without a Figma lookup.
type Reference = { id: string; key: string; remote: boolean; name?: string };
type Lookup = { kind: 'variable' | 'style'; ref: Reference };
type RecipeGroup = { values: Record<string, Json>; bindings: Record<string, Reference>; style?: Reference };
// `rev` increases whenever the recipe changes (not on rename), so copies elsewhere can tell they are stale.
type StyleClass = { id: string; name: string; rev: number; createdAt: number; updatedAt: number; groups: Partial<Record<Group, RecipeGroup>> };
type Database = { schemaVersion: 2; classes: StyleClass[] };
const SCHEMA_VERSION = 2;
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
    const results = new Map<string, { key: string; remote: boolean; name: string }>();
    const pending = new Map<string, Promise<void>>();
    for (const { kind, ref } of lookups) {
      const key = kind + ':' + ref.id;
      if (pending.has(key)) continue;
      pending.set(key, (async () => {
        try {
          const found = kind === 'variable' ? await figma.variables.getVariableByIdAsync(ref.id) : await figma.getStyleByIdAsync(ref.id);
          if (found) results.set(key, { key: found.key, remote: found.remote, name: found.name });
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
      if (metadata) { ref.key = metadata.key; ref.remote = metadata.remote; ref.name = metadata.name; }
      else warnings.add('Some reference metadata was unavailable. Bindings and styles were saved by ID for this document; published-key recovery may be unavailable.');
    }
    // Late API completions only touch the private results map, never saved recipes.
  },
  // Library classes were captured in another file, where a local ID could match an unrelated variable here:
  // resolve those by published key only.
  async variable(ref: Reference, byKey = false): Promise<Variable | null> {
    if (byKey) { if (!ref.key) return null; try { return await figma.variables.importVariableByKeyAsync(ref.key); } catch { return null; } }
    try { const found = await figma.variables.getVariableByIdAsync(ref.id); if (found) return found; } catch { /* Try published key. */ }
    if (ref.remote && ref.key) { try { return await figma.variables.importVariableByKeyAsync(ref.key); } catch { /* Fallback. */ } }
    return null;
  },
  async decode(value: Json, warnings: Set<string>, byKey = false): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(v => Serialization.decode(v, warnings, byKey)));
    if (typeof value !== 'object' || value === null) return value;
    if ('$variable' in value) {
      const variable = await Serialization.variable(value.$variable as Reference, byKey);
      if (!variable) { warnings.add('Missing variables: saved literal values used.'); return undefined; }
      return figma.variables.createVariableAlias(variable);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const decoded = await Serialization.decode(value[key], warnings, byKey);
      if (decoded !== undefined) result[key] = decoded;
    }
    return result;
  },
  async style(ref: Reference, byKey = false): Promise<BaseStyle | null> {
    if (byKey) { if (!ref.key) return null; try { return await figma.importStyleByKeyAsync(ref.key); } catch { return null; } }
    try { const found = await figma.getStyleByIdAsync(ref.id); if (found) return found; } catch { /* Try key. */ }
    if (ref.remote && ref.key) { try { return await figma.importStyleByKeyAsync(ref.key); } catch { /* Fallback. */ } }
    return null;
  },
};

// Schema module: validation and upgrades shared by every store (document now, library next).
const Schema = {
  // v1 -> v2: add rev. Reference names stay absent until a class is next captured.
  upgrade(data: unknown): Database {
    const db = data as { schemaVersion?: number; classes?: unknown };
    if (!db || (db.schemaVersion !== 1 && db.schemaVersion !== SCHEMA_VERSION) || !Array.isArray(db.classes)) {
      throw new Error('Saved classes use an unsupported or damaged format. Existing data was not changed.');
    }
    const classes = db.classes.map(c => Schema.styleClass(c));
    return { schemaVersion: SCHEMA_VERSION, classes };
  },
  styleClass(data: unknown): StyleClass {
    const c = data as StyleClass;
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !c.groups || Object.keys(c.groups).some(g => !GROUPS.includes(g as Group))) {
      throw new Error('Saved classes use an unsupported or damaged format. Existing data was not changed.');
    }
    return { ...c, rev: typeof c.rev === 'number' && c.rev > 0 ? c.rev : 1 };
  },
};

// Storage module: versioned document-scoped envelope. Key name predates the rename; kept for existing files.
const DocumentStorage = {
  key: 'style_classes_v1',
  read(): Database {
    const raw = figma.root.getPluginData(DocumentStorage.key);
    if (!raw) return { schemaVersion: SCHEMA_VERSION, classes: [] };
    return Schema.upgrade(JSON.parse(raw));
  },
  write(db: Database): void {
    const raw = JSON.stringify(db);
    if (raw.length > 80000) throw new Error('Document class storage is full. Remove a class or use a smaller recipe.');
    figma.root.setPluginData(DocumentStorage.key, raw);
  },
};

// Library store: one STRING variable per class in a publishable "Style Stacks" collection, so classes
// publish and update like components. Value = StyleClass JSON; scopes [] keep it out of property pickers;
// the description marks it so sync tooling can skip it. Readers skip values they can't parse.
type LibraryEntry = { variable: Variable; cls: StyleClass };
const LibraryStorage = {
  collectionName: 'Style Stacks',
  marker: 'style-stacks:class v' + SCHEMA_VERSION,
  async collection(create: boolean): Promise<VariableCollection | null> {
    const all = await figma.variables.getLocalVariableCollectionsAsync();
    const found = all.find(c => c.getPluginData('role') === 'classes') ?? all.find(c => c.name === LibraryStorage.collectionName);
    if (found || !create) return found ?? null;
    const created = figma.variables.createVariableCollection(LibraryStorage.collectionName);
    created.setPluginData('role', 'classes');
    return created;
  },
  version(description: string): number | null {
    const match = /^style-stacks:class v(\d+)$/.exec(description.trim());
    return match ? Number(match[1]) : null;
  },
  async entries(): Promise<LibraryEntry[]> {
    const collection = await LibraryStorage.collection(false);
    if (!collection) return [];
    const result: LibraryEntry[] = [];
    for (const id of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (!variable || variable.resolvedType !== 'STRING') continue;
      // Written by a newer plugin version: leave it alone rather than downgrade it on the next write.
      const version = LibraryStorage.version(variable.description);
      if (version !== null && version > SCHEMA_VERSION) continue;
      const raw = variable.valuesByMode[collection.defaultModeId];
      if (typeof raw !== 'string') continue;
      try { result.push({ variable, cls: Schema.styleClass(JSON.parse(raw)) }); } catch { /* Not a class; skip. */ }
    }
    return result;
  },
  async read(): Promise<StyleClass[]> {
    return (await LibraryStorage.entries()).map(entry => entry.cls);
  },
  rename(variable: Variable, cls: StyleClass): void {
    // Variable names reject some characters; the class name inside the JSON stays exact either way.
    const safe = cls.name.replace(/[.{}$\\]/g, '-');
    for (const candidate of [cls.name, safe, safe + ' ' + cls.id]) {
      if (variable.name === candidate) return;
      try { variable.name = candidate; return; } catch { /* Try the next candidate. */ }
    }
    throw new Error('Could not save that name to the library. Try a simpler name.');
  },
  async write(cls: StyleClass): Promise<void> {
    const collection = (await LibraryStorage.collection(true))!;
    if (collection.hiddenFromPublishing) collection.hiddenFromPublishing = false;
    const existing = (await LibraryStorage.entries()).find(entry => entry.cls.id === cls.id)?.variable;
    const variable = existing ?? figma.variables.createVariable('style-stacks ' + cls.id, collection, 'STRING');
    try {
      variable.setValueForMode(collection.defaultModeId, JSON.stringify(Schema.styleClass(cls)));
      LibraryStorage.rename(variable, cls);
      variable.scopes = [];
      variable.description = LibraryStorage.marker;
      if (variable.hiddenFromPublishing) variable.hiddenFromPublishing = false;
    } catch (error) {
      if (!existing) variable.remove();
      throw error;
    }
  },
  async remove(id: string): Promise<void> {
    const entry = (await LibraryStorage.entries()).find(e => e.cls.id === id);
    if (!entry) throw new Error('Class no longer exists.');
    entry.variable.remove();
  },
};

// Library catalog: classes published by libraries this file uses. Listing reads names only (fast, no
// imports); a class is imported on apply, which always returns the latest published version.
type CatalogEntry = { key: string; name: string; library: string };
const LibraryCatalog = {
  async list(): Promise<CatalogEntry[]> {
    const own = new Set((await figma.variables.getLocalVariableCollectionsAsync()).map(c => c.key));
    const collections = (await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()).filter(c => c.name === LibraryStorage.collectionName && !own.has(c.key));
    const lists = await Promise.all(collections.map(async c => (await figma.teamLibrary.getVariablesInLibraryCollectionAsync(c.key))
      .filter(v => v.resolvedType === 'STRING')
      .map(v => ({ key: v.key, name: v.name, library: c.libraryName }))));
    return lists.flat().sort((a, b) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name));
  },
  async load(key: string): Promise<StyleClass> {
    let variable: Variable;
    try { variable = await figma.variables.importVariableByKeyAsync(key); }
    catch { throw new Error('This class is no longer available in its library.'); }
    const version = LibraryStorage.version(variable.description);
    if (version !== null && version > SCHEMA_VERSION) throw new Error('This class was saved with a newer version of Style Stacks. Update the plugin to use it.');
    const raw = Object.values(variable.valuesByMode)[0];
    try { return Schema.styleClass(JSON.parse(raw as string)); }
    catch { throw new Error('This class couldn’t be read. Ask the library owner to save it again.'); }
  },
};
let catalog: CatalogEntry[] = [];
async function refreshCatalog(): Promise<void> {
  try { catalog = await LibraryCatalog.list(); } catch { catalog = []; }
  void pushState();
}

// Portability module: plain-language reasons a library class won't look the same in other files.
const FIELD_LABELS: Record<string, string> = {
  strokeWeight: 'Stroke width', strokeTopWeight: 'Stroke width', strokeRightWeight: 'Stroke width', strokeBottomWeight: 'Stroke width', strokeLeftWeight: 'Stroke width',
  cornerRadius: 'Corner radius', topLeftRadius: 'Corner radius', topRightRadius: 'Corner radius', bottomLeftRadius: 'Corner radius', bottomRightRadius: 'Corner radius',
  paddingLeft: 'Padding', paddingRight: 'Padding', paddingTop: 'Padding', paddingBottom: 'Padding', itemSpacing: 'Gap', counterAxisSpacing: 'Row gap',
};
const FIELD_SCOPE: Record<string, VariableScope> = {
  strokeWeight: 'STROKE_FLOAT', strokeTopWeight: 'STROKE_FLOAT', strokeRightWeight: 'STROKE_FLOAT', strokeBottomWeight: 'STROKE_FLOAT', strokeLeftWeight: 'STROKE_FLOAT',
  cornerRadius: 'CORNER_RADIUS', topLeftRadius: 'CORNER_RADIUS', topRightRadius: 'CORNER_RADIUS', bottomLeftRadius: 'CORNER_RADIUS', bottomRightRadius: 'CORNER_RADIUS',
  paddingLeft: 'GAP', paddingRight: 'GAP', paddingTop: 'GAP', paddingBottom: 'GAP', itemSpacing: 'GAP', counterAxisSpacing: 'GAP',
};
// Figma records a uniform binding on the per-side fields, never on the shorthand, so check the sides instead.
const SHORTHANDS: Record<string, string[]> = {
  cornerRadius: ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'],
  strokeWeight: ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'],
};
const PAINT_SCOPES: Record<string, VariableScope[]> = { fills: ['ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'], strokes: ['STROKE_COLOR'], effects: ['EFFECT_COLOR'] };
type Rgba = { r: number; g: number; b: number; a: number };
type Token = { name: string; scopes: VariableScope[]; value: number | Rgba };
const Portability = {
  hex(c: Rgba): string {
    const part = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
    return '#' + (part(c.r) + part(c.g) + part(c.b)).toUpperCase() + (c.a < 0.999 ? ' at ' + Math.round(c.a * 100) + '%' : '');
  },
  async resolve(variable: Variable, depth = 0): Promise<VariableValue | null> {
    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    const value = collection ? variable.valuesByMode[collection.defaultModeId] : undefined;
    if (value === undefined) return null;
    if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
      const target = depth < 5 ? await figma.variables.getVariableByIdAsync(value.id) : null;
      return target ? Portability.resolve(target, depth + 1) : null;
    }
    return value;
  },
  // Publishable local tokens a raw value could have used instead.
  async tokens(): Promise<Token[]> {
    const tokens: Token[] = [];
    const hidden = new Map<string, boolean>();
    for (const type of ['COLOR', 'FLOAT'] as const) {
      for (const variable of await figma.variables.getLocalVariablesAsync(type)) {
        if (variable.hiddenFromPublishing || !variable.scopes.length) continue;
        if (!hidden.has(variable.variableCollectionId)) hidden.set(variable.variableCollectionId, (await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId))?.hiddenFromPublishing ?? true);
        if (hidden.get(variable.variableCollectionId)) continue;
        const value = await Portability.resolve(variable);
        if (typeof value === 'number') tokens.push({ name: variable.name, scopes: variable.scopes, value });
        else if (value && typeof value === 'object' && 'r' in value) tokens.push({ name: variable.name, scopes: variable.scopes, value: { r: value.r, g: value.g, b: value.b, a: 'a' in value ? value.a : 1 } });
      }
    }
    return tokens;
  },
  match(tokens: Token[], value: number | Rgba, scopes: VariableScope[]): Token | undefined {
    return tokens.find(token => {
      if (!token.scopes.includes('ALL_SCOPES') && !token.scopes.some(s => scopes.includes(s))) return false;
      if (typeof value === 'number') return typeof token.value === 'number' && Math.abs(token.value - value) < 0.001;
      const t = token.value;
      return typeof t === 'object' && (['r', 'g', 'b', 'a'] as const).every(k => Math.abs(t[k] - value[k]) < 0.002);
    });
  },
  collect(value: Json, refs: Reference[]): void {
    if (Array.isArray(value)) { value.forEach(v => Portability.collect(v, refs)); return; }
    if (!value || typeof value !== 'object') return;
    if ('$variable' in value) { refs.push(value.$variable as Reference); return; }
    for (const key of Object.keys(value)) Portability.collect(value[key], refs);
  },
  async issues(groups: Partial<Record<Group, RecipeGroup>>): Promise<string[]> {
    const issues = new Set<string>();
    const variables: Reference[] = [], styles: Reference[] = [];
    for (const recipe of Object.values(groups)) {
      if (!recipe) continue;
      Portability.collect(recipe.values, variables);
      variables.push(...Object.values(recipe.bindings));
      if (recipe.style) styles.push(recipe.style);
    }
    for (const id of new Set(variables.map(ref => ref.id))) {
      const variable = await figma.variables.getVariableByIdAsync(id).catch(() => null);
      if (!variable) { issues.add('It uses a variable that is missing from this file.'); continue; }
      if (variable.remote) continue;
      const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
      if (variable.hiddenFromPublishing || collection?.hiddenFromPublishing) issues.add('“' + variable.name + '” is hidden from publishing, so other files can’t use it.');
      else if (await variable.getPublishStatusAsync() === 'UNPUBLISHED') issues.add('“' + variable.name + '” isn’t published yet. Include it when you publish the library.');
    }
    for (const id of new Set(styles.map(ref => ref.id))) {
      const style = await figma.getStyleByIdAsync(id).catch(() => null);
      if (!style) { issues.add('It uses a style that is missing from this file.'); continue; }
      if (style.remote) continue;
      if (/^[._]/.test(style.name)) issues.add('The “' + style.name + '” style is hidden from publishing, so other files can’t use it.');
      else if (await style.getPublishStatusAsync() === 'UNPUBLISHED') issues.add('The “' + style.name + '” style isn’t published yet. Include it when you publish the library.');
    }
    let tokens: Token[] | null = null;
    const token = async (value: number | Rgba, scopes: VariableScope[]) => Portability.match(tokens ??= await Portability.tokens(), value, scopes);
    for (const group of GROUPS) {
      const recipe = groups[group];
      if (!recipe) continue;
      for (const field of ['fills', 'strokes'] as const) {
        const paints = recipe.values[field];
        if (!Array.isArray(paints)) continue;
        for (const paint of paints as Record<string, Json>[]) {
          if (paint.type === 'IMAGE') issues.add('Images can’t be shared through a library, so image fills won’t show up in other files.');
          if (paint.type === 'PATTERN') issues.add('Pattern fills point to a layer in this file, so they won’t work in other files.');
          const bound = paint.boundVariables as Record<string, Json> | undefined;
          if (paint.type === 'SOLID' && !recipe.style && !bound?.color && paint.color && typeof paint.color === 'object') {
            const c = paint.color as Record<string, number>;
            const value = { r: c.r, g: c.g, b: c.b, a: typeof paint.opacity === 'number' ? paint.opacity : 1 };
            const found = await token(value, PAINT_SCOPES[field]);
            if (found) issues.add((field === 'fills' ? 'Fill ' : 'Stroke ') + Portability.hex(value) + ' matches “' + found.name + '” but isn’t linked to it.');
          }
        }
      }
      if (Array.isArray(recipe.values.effects) && !recipe.style) {
        for (const effect of recipe.values.effects as Record<string, Json>[]) {
          const bound = effect.boundVariables as Record<string, Json> | undefined;
          if (!effect.color || typeof effect.color !== 'object' || bound?.color) continue;
          const c = effect.color as Record<string, number>;
          const value = { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 };
          const found = await token(value, PAINT_SCOPES.effects);
          if (found) issues.add('Shadow color ' + Portability.hex(value) + ' matches “' + found.name + '” but isn’t linked to it.');
        }
      }
      for (const field of Object.keys(recipe.values)) {
        const value = recipe.values[field];
        if (!BINDABLE.has(field) || recipe.bindings[field] || typeof value !== 'number' || value === 0) continue;
        if (SHORTHANDS[field]?.some(side => side in recipe.values)) continue;
        const found = await token(value, [FIELD_SCOPE[field]]);
        if (found) issues.add(FIELD_LABELS[field] + ' ' + value + ' matches “' + found.name + '” but isn’t linked to it.');
      }
    }
    const list = [...issues];
    return list.length > 8 ? [...list.slice(0, 7), 'And ' + (list.length - 7) + ' more.'] : list;
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
  async group(node: SceneNode, group: Group, recipe: RecipeGroup, warnings: Set<string>, byKey = false): Promise<void> {
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
    for (const field of Object.keys(recipe.values)) values[field] = await Serialization.decode(recipe.values[field], warnings, byKey);
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
      const variable = await Serialization.variable(recipe.bindings[field], byKey);
      if (variable) node.setBoundVariable(field as VariableBindableNodeField, variable);
      else warnings.add('Missing variables: saved literal values used.');
    }
    if (recipe.style) {
      const style = await Serialization.style(recipe.style, byKey);
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
type Found = { cls: StyleClass; library: boolean };
// Library reads fail soft so a file without variable access still shows its document classes.
async function libraryClasses(): Promise<StyleClass[]> {
  try { return await LibraryStorage.read(); } catch { return []; }
}
async function findClass(id: string | undefined): Promise<Found | null> {
  if (!id) return null;
  const local = DocumentStorage.read().classes.find(c => c.id === id);
  if (local) return { cls: local, library: false };
  const library = (await libraryClasses()).find(c => c.id === id);
  return library ? { cls: library, library: true } : null;
}
// Names stay unique across this file's document and library classes so the list is unambiguous.
async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const all = [...DocumentStorage.read().classes, ...await libraryClasses()];
  return all.some(c => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
}
let stateSequence = 0;
async function pushState(): Promise<void> {
  const sequence = ++stateSequence;
  try {
    const local = DocumentStorage.read().classes;
    const library = await libraryClasses();
    if (sequence !== stateSequence) return;
    const selection = figma.currentPage.selection;
    const available = selection.filter(editable);
    const source = selection.length === 1 && available.length === 1 ? available[0] : null;
    const summary = (c: StyleClass, inLibrary: boolean) => ({ id: c.id, name: c.name, groups: Object.keys(c.groups), library: inLibrary });
    figma.ui.postMessage({ type: 'state', libraryClasses: catalog, classes: [...local.map(c => summary(c, false)), ...library.map(c => summary(c, true))], count: available.length, total: selection.length, source: source?.name ?? null, groups: source ? GROUPS.filter(g => Capture.supported(source, g)) : [] });
  } catch (error) { figma.ui.postMessage({ type: 'feedback', error: true, text: messageOf(error) }); }
}
type Message = { type: string; requestId?: string; id?: string; key?: string; name?: string; groups?: Group[]; library?: boolean; confirmed?: boolean };
let busy = false;
// Custom plugins are namespaced by the host; the manifest UUID is not the routing ID.
figma.showUI(__html__.replace('"__STYLE_STACKS_RUNTIME_ID__"', JSON.stringify(figma.pluginId ?? '')), { width: 340, height: 620, themeColors: true });
figma.root.setRelaunchData({ 'bfc5a14b-b1c2-4cbe-85e2-4173cdd491c8': 'Style Stacks' });
figma.on('selectionchange', () => { void pushState(); });
const PUBLISH_HINT = ' Publish the library to share it with other files.';
const PUBLISH_CHANGE = ' Publish the library to share the change.';
figma.ui.onmessage = async (msg: Message) => {
  if (msg.type === 'ready') { void pushState(); void refreshCatalog(); return; }
  if (busy) { figma.ui.postMessage({ type: 'feedback', requestId: msg.requestId, error: true, text: 'Another action is still running. Please wait before retrying.' }); return; }
  busy = true;
  const warnings = new Set<string>();
  // Library saves stop here once with a portability warning; the UI resends with `confirmed` to continue.
  const portable = async (groups: Partial<Record<Group, RecipeGroup>>): Promise<boolean> => {
    if (msg.confirmed) return true;
    const issues = await Portability.issues(groups);
    if (!issues.length) return true;
    figma.ui.postMessage({ type: 'feedback', requestId: msg.requestId, error: false, portability: issues, text: '' });
    return false;
  };
  try {
    const found = await findClass(msg.id);
    const existing = found?.cls;
    let text = '';
    if (msg.type === 'save' || msg.type === 'update') {
      const selection = figma.currentPage.selection;
      if (selection.length !== 1 || !editable(selection[0])) throw new Error('Select one editable, compatible layer.');
      if (msg.type === 'update' && !existing) throw new Error('Class no longer exists.');
      const groups = msg.type === 'update' && existing ? Object.keys(existing.groups) as Group[] : [...new Set(msg.groups ?? [])].filter(g => GROUPS.includes(g));
      if (!groups.length) throw new Error('Choose at least one property group.');
      const name = msg.type === 'update' && existing ? existing.name : (msg.name ?? '').trim();
      if (!name || name.length > 80) throw new Error('Enter a class name of 1–80 characters.');
      if (await nameTaken(name, existing?.id)) throw new Error('A class with that name already exists.');
      const toLibrary = msg.type === 'update' ? !!found?.library : !!msg.library;
      const groupsData = await Capture.recipe(selection[0], groups, warnings);
      if (toLibrary && !await portable(groupsData)) return;
      // Metadata resolution yields to other plugin instances. Merge into fresh storage.
      if (msg.type === 'update') {
        const latest = await findClass(existing!.id);
        if (!latest || JSON.stringify(latest.cls) !== JSON.stringify(existing)) throw new Error('Class changed while capturing. Try updating again.');
      }
      if (await nameTaken(name, existing?.id)) throw new Error('A class with that name already exists.');
      const now = Date.now();
      const result: StyleClass = { id: existing?.id ?? now.toString(36) + Math.random().toString(36).slice(2, 9), name, rev: existing ? existing.rev + 1 : 1, groups: groupsData, createdAt: existing?.createdAt ?? now, updatedAt: now };
      if (toLibrary) {
        await LibraryStorage.write(result);
        text = msg.type === 'update' ? 'Updated “' + name + '” in the library. Previously styled layers are unchanged.' + PUBLISH_CHANGE : 'Saved “' + name + '” to the library.' + PUBLISH_HINT;
      } else {
        const latest = DocumentStorage.read();
        const index = latest.classes.findIndex(c => c.id === result.id);
        if (index >= 0) latest.classes[index] = result; else latest.classes.push(result);
        DocumentStorage.write(latest);
        text = msg.type === 'update' ? 'Class updated. Previously styled layers are unchanged.' : 'Saved “' + name + '”.';
      }
    } else if (msg.type === 'move') {
      if (!found) throw new Error('Class no longer exists.');
      if (found.library) throw new Error('This class is already in the library.');
      if (!await portable(found.cls.groups)) return;
      await LibraryStorage.write({ ...found.cls, updatedAt: Date.now() });
      const latest = DocumentStorage.read();
      latest.classes = latest.classes.filter(c => c.id !== found.cls.id);
      DocumentStorage.write(latest);
      text = 'Added “' + found.cls.name + '” to the library.' + PUBLISH_HINT;
    } else if (msg.type === 'rename') {
      if (!found) throw new Error('Class no longer exists.');
      const name = (msg.name ?? '').trim();
      if (!name || name.length > 80) throw new Error('Enter a class name of 1–80 characters.');
      if (await nameTaken(name, found.cls.id)) throw new Error('A class with that name already exists.');
      const renamed = { ...found.cls, name, updatedAt: Date.now() };
      if (found.library) { await LibraryStorage.write(renamed); text = 'Class renamed.' + PUBLISH_CHANGE; }
      else {
        const db = DocumentStorage.read();
        db.classes = db.classes.map(c => c.id === renamed.id ? renamed : c);
        DocumentStorage.write(db); text = 'Class renamed.';
      }
    } else if (msg.type === 'delete') {
      if (!found) throw new Error('Class no longer exists.');
      if (found.library) { await LibraryStorage.remove(found.cls.id); text = 'Class deleted. Other files keep it until you publish the library.'; }
      else {
        const db = DocumentStorage.read();
        db.classes = db.classes.filter(c => c.id !== found.cls.id);
        DocumentStorage.write(db); text = 'Class deleted.';
      }
    } else if (msg.type === 'apply') {
      // Classes from connected libraries are loaded fresh by key; their references resolve by key too.
      const byKey = !!msg.key;
      const cls = msg.key ? await LibraryCatalog.load(msg.key) : existing;
      if (!cls) throw new Error('Class no longer exists.');
      const selection = [...figma.currentPage.selection];
      if (!selection.length) throw new Error('Select a compatible layer.');
      let applied = 0;
      for (const node of selection) {
        if (!editable(node)) { warnings.add('Locked or unsupported layers were skipped.'); continue; }
        let changed = false;
        for (const group of GROUPS) {
          const recipe = cls.groups[group];
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
            try { await Application.group(node, group, recipe, warnings, byKey); changed = true; }
            catch (error) {
              try { await Application.group(node, group, before, new Set<string>()); } catch { warnings.add('Could not fully restore a rejected group.'); }
              warnings.add(messageOf(error));
            }
          } catch (error) { warnings.add(messageOf(error)); }
        }
        if (changed) applied++;
      }
      if (!applied) throw new Error([...warnings].join(' ') || 'No compatible property groups in the selection.');
      text = 'Applied “' + cls.name + '” to ' + applied + (applied === 1 ? ' layer.' : ' layers.');
    } else { throw new Error('Unknown action.'); }
    figma.ui.postMessage({ type: 'feedback', requestId: msg.requestId, error: false, saved: msg.type === 'save', text: text + (warnings.size ? ' ' + [...warnings].join(' ') : '') });
  } catch (error) { figma.ui.postMessage({ type: 'feedback', requestId: msg.requestId, error: true, text: messageOf(error) }); }
  finally { busy = false; void pushState(); }
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
