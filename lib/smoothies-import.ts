type Row = Record<string, unknown>;

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('El archivo contiene un registro inválido.');
  return value as Row;
}

function field(value: unknown, title: string, limit: number, required = true) {
  if (typeof value !== 'string') throw Error(`Revisa el campo ${title}.`);
  const result = value.normalize('NFC').trim();
  if (result.length > limit || (required && !result)) throw Error(`Revisa el campo ${title}.`);
  return result;
}

function decimal(value: unknown, title: string, precision: number, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > 1000000
      || Math.abs(Math.round(value * precision) - value * precision) > 0.000001) {
    throw Error(`Revisa ${title}.`);
  }
  return value;
}

const nameKey = (name: string) => name.replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');

export function parseSmoothiesForm(input: unknown) {
  const file = object(input);
  if (file.version !== 1) throw Error('Usa un archivo descargado desde el formulario de smoothies.');
  if (file.drafts !== undefined && Object.keys(object(file.drafts)).length) {
    throw Error('Abre la copia en el formulario, termina las filas pendientes y usa Revisar → Compartir mis datos.');
  }

  const ids = new Set<string>();
  function rows<T extends { id: string }>(key: string, parse: (row: Row, id: string) => T): T[] {
    const values = file[key];
    if (!Array.isArray(values) || values.length > 500) throw Error(`Revisa la lista de ${key}.`);
    return values.map(value => {
      const row = object(value);
      if (typeof row.id !== 'string' || !/^[a-z0-9-]{16,50}$/i.test(row.id) || ids.has(row.id.toLowerCase())) {
        throw Error('El archivo contiene una clave de registro inválida o repetida.');
      }
      const id = row.id.toLowerCase();
      ids.add(id);
      return parse(row, id);
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  const menu = rows('menu', (r, id) => {
    const name = field(r.name, 'producto', 100);
    const size = field(r.size, 'tamaño', 40);
    return { id, name, size, displayName: nameKey(size) === 'único' ? name : `${name} ${size}`,
      price: decimal(r.price, 'el precio del producto', 100, 0.01), notes: field(r.notes, 'ingredientes', 300, false) };
  });
  if (!menu.length) throw Error('El archivo debe incluir al menos un producto.');
  if (new Set(menu.map(p => nameKey(p.displayName))).size !== menu.length) throw Error('Dos presentaciones quedarían con el mismo nombre en caja.');
  const menuIds = new Set(menu.map(p => p.id));
  const extras = rows('extras', (r, id) => {
    const name = field(r.name, 'extra', 100);
    if (!Array.isArray(r.productIds) || r.productIds.length > menu.length || (r.scope !== 'all' && r.scope !== 'selected')) {
      throw Error(`Revisa a qué productos aplica ${name}.`);
    }
    const selected = r.productIds.map(value => {
      if (typeof value !== 'string' || !menuIds.has(value.toLowerCase())) throw Error(`El extra ${name} apunta a un producto que falta.`);
      return value.toLowerCase();
    });
    if ((r.scope === 'all' && selected.length) || (r.scope === 'selected' && !selected.length) || new Set(selected).size !== selected.length) {
      throw Error(`Revisa la asignación del extra ${name}.`);
    }
    if (r.kind !== undefined && r.kind !== 'milk' && r.kind !== 'add-on') throw Error(`Revisa el tipo de extra de ${name}.`);
    const milk = r.kind === 'milk' || (r.kind === undefined && /^(?:cambio a )?leche\b/i.test(name));
    return { id, name, price: decimal(r.price, 'el precio del extra', 100),
      phase: milk ? 'Leche alternativa' : 'Extras',
      productIds: r.scope === 'all' ? [...menuIds] : selected.sort() };
  });
  if (new Set(extras.map(e => nameKey(e.name))).size !== extras.length) throw Error('El archivo contiene nombres de extras repetidos.');
  const stock = rows('stock', (r, id) => ({
    id, name: field(r.name, 'insumo', 100), unit: field(r.unit, 'unidad', 35),
    quantity: r.quantity === null ? null : decimal(r.quantity, 'la cantidad prevista', 1000),
    pack: field(r.pack, 'presentación de compra', 120, false),
    cost: r.cost === null ? null : decimal(r.cost, 'el costo previsto', 100),
  }));
  if (new Set(stock.map(r => nameKey(r.name))).size !== stock.length) throw Error('Hay insumos con el mismo nombre. Distingue las presentaciones antes de importar.');
  const colors = file.palette === undefined ? {} : object(file.palette);
  const palette = Object.fromEntries(['neutral','solid','secondary','notes'].map(name =>
    [name, field(colors[name] ?? '', 'color', 300, false)]));
  return { menu, extras, stock, palette };
}
