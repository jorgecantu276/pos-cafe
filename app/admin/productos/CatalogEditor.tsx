'use client';

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import AdminDialog from '../AdminDialog';

export interface CatalogForm {
  name: string; price: string; category: string; phase: string; customizable: boolean; image_url: string; wizard_steps: string[];
}
export default function CatalogEditor({ type, editing, values, onChange, categories, phases, busy, pending, message, onSubmit, onClose }: {
  type: 'items' | 'extras'; editing: boolean; values: CatalogForm; onChange: Dispatch<SetStateAction<CatalogForm>>;
  categories: string[]; phases: string[]; busy: boolean; pending: boolean; message: string;
  onSubmit: (event: FormEvent) => void; onClose: () => void;
}) {
  const [newCategory, setNewCategory] = useState(false), [newPhase, setNewPhase] = useState(false);
  const noun = type === 'items' ? 'producto' : 'extra', disabled = busy || pending;
  return <AdminDialog title={`${editing ? 'Editar' : 'Nuevo'} ${noun}`} onClose={onClose} busy={busy} wide footer={<>
    <button type="button" className="admin-secondary-button" disabled={busy} onClick={onClose}>{pending ? 'Cerrar' : 'Cancelar'}</button>
    <button type="submit" form="catalog-editor-form" className="admin-primary-button" disabled={disabled}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar nuevo'}</button>
  </>}>
    {message && <p role="status" className="admin-form-message">{message}</p>}
    {pending && <p role="alert">Hay un guardado sin confirmar. Cierra esta ventana y recupera la misma solicitud.</p>}
    <form id="catalog-editor-form" onSubmit={onSubmit}>
      <fieldset disabled={disabled} className="catalog-fields">
        <label className="admin-field catalog-field-name">Nombre<input data-dialog-autofocus name="name" value={values.name} required maxLength={200} onChange={e => onChange({ ...values, name: e.target.value })}/></label>
        <label className="admin-field">Precio (MXN)<input name="price" type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={values.price} required onChange={e => onChange({ ...values, price: e.target.value })}/></label>
        {type === 'items' ? <>
          <div className="admin-field">{newCategory ? <>
            <label htmlFor="catalog-new-category">Nueva categoría</label><div className="admin-inline-field"><input id="catalog-new-category" required maxLength={100} value={values.category} onChange={e => onChange({ ...values, category: e.target.value })}/><button type="button" onClick={() => { setNewCategory(false); onChange({ ...values, category: categories[0] }); }}>Elegir existente</button></div>
          </> : <label>Categoría<select value={values.category} onChange={e => { if (e.target.value === '__NEW__') { setNewCategory(true); onChange({ ...values, category: '' }); } else onChange({ ...values, category: e.target.value }); }}>{categories.map(c => <option key={c}>{c}</option>)}<option value="__NEW__">Crear categoría…</option></select></label>}</div>
          <div className="catalog-preparation"><label className="admin-check-label"><input type="checkbox" checked={values.customizable} onChange={e => onChange({ ...values, customizable: e.target.checked })}/>Permitir opciones de preparación</label>
            {values.customizable && <fieldset className="catalog-option-groups"><legend>Grupos disponibles para este producto</legend><div>{phases.map(phase => <label key={phase} className="admin-check-label"><input type="checkbox" checked={values.wizard_steps.includes(phase)} onChange={e => onChange({ ...values, wizard_steps: e.target.checked ? [...values.wizard_steps, phase] : values.wizard_steps.filter(v => v !== phase) })}/>{phase}</label>)}</div></fieldset>}
          </div>
          <details className="catalog-photo" open={!!values.image_url}><summary>Foto opcional</summary><label className="admin-field">Enlace de la foto<input type="url" name="image_url" maxLength={2048} value={values.image_url} onChange={e => onChange({ ...values, image_url: e.target.value })}/></label><p>Sin foto, la caja muestra el nombre y precio.</p></details>
        </> : <div className="admin-field">{newPhase ? <>
          <label htmlFor="catalog-new-phase">Nuevo grupo de extras</label><div className="admin-inline-field"><input id="catalog-new-phase" required maxLength={100} value={values.phase} onChange={e => onChange({ ...values, phase: e.target.value })}/><button type="button" onClick={() => { setNewPhase(false); onChange({ ...values, phase: phases[0] }); }}>Elegir existente</button></div>
        </> : <label>Grupo de extras<select value={values.phase} onChange={e => { if (e.target.value === '__NEW__') { setNewPhase(true); onChange({ ...values, phase: '' }); } else onChange({ ...values, phase: e.target.value }); }}>{phases.map(phase => <option key={phase}>{phase}</option>)}<option value="__NEW__">Crear grupo…</option></select></label>}</div>}
      </fieldset>
    </form>
  </AdminDialog>;
}
