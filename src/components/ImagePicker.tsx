import { useEffect, useRef, useState } from 'react';
import { cropImage, readImage } from '../images';

export function ImagePicker({ label, value, onChange, disabled = false }: {
  label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean;
}) {
  const bitmap = useRef<ImageBitmap | null>(null);
  const revision = useRef(0);
  const [crop, setCrop] = useState({ zoom: 1, horizontal: 50, vertical: 50 });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => () => { revision.current++; bitmap.current?.close(); }, []);
  function adjust(next: typeof crop) {
    setCrop(next);
    if (bitmap.current) {
      try { onChange(cropImage(bitmap.current, next.zoom, next.horizontal, next.vertical)); }
      catch (e) { setError((e as Error).message); }
    }
  }
  return <div className="image-picker">
    <div className="image-preview">{value ? <img src={value} alt={`${label} preview`} /> : <span aria-label="No image">◈</span>}</div>
    <label className="image-upload">{label}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || loading} onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      const current = ++revision.current; setLoading(true); setError('');
      try {
        const next = await readImage(file);
        if (current !== revision.current) { next.close(); return; }
        let image: string;
        try { image = cropImage(next, 1, 50, 50); }
        catch (e) { next.close(); throw e; }
        bitmap.current?.close(); bitmap.current = next;
        setCrop({ zoom: 1, horizontal: 50, vertical: 50 }); setEditing(true); onChange(image);
      } catch (e) { if (current === revision.current) setError((e as Error).message); }
      finally { if (current === revision.current) setLoading(false); }
    }} /></label>
    <p className="fine">PNG, JPEG, or WebP · up to 5 MB. Saved as a 128 × 128 PNG.</p>
    {loading && <p role="status">Preparing image…</p>}
    {editing && <div className="crop-controls">
      <label>Zoom<input aria-label={`${label} zoom`} type="range" min={1} max={3} step={.05} value={crop.zoom} disabled={disabled} onChange={e => adjust({ ...crop, zoom: Number(e.target.value) })} /></label>
      <label>Horizontal position<input aria-label={`${label} horizontal position`} type="range" min={0} max={100} value={crop.horizontal} disabled={disabled} onChange={e => adjust({ ...crop, horizontal: Number(e.target.value) })} /></label>
      <label>Vertical position<input aria-label={`${label} vertical position`} type="range" min={0} max={100} value={crop.vertical} disabled={disabled} onChange={e => adjust({ ...crop, vertical: Number(e.target.value) })} /></label>
    </div>}
    {value && <button type="button" className="textbutton" disabled={disabled || loading} onClick={() => { bitmap.current?.close(); bitmap.current=null; setEditing(false); setError(''); onChange(null); }}>Remove image</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
