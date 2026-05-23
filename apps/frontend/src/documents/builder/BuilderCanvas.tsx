import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, Plus } from 'lucide-react';
import type { TemplateRow } from '../api/documentBuilderApi';

interface RowItemProps {
  row: TemplateRow;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string | null, rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
}

function RowItem({ row, selectedFieldId, onSelectField, onDeleteRow }: RowItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const colClass = row.columns === 1 ? 'grid-cols-1' : row.columns === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1 group">
      <button
        {...attributes}
        {...listeners}
        className="mt-2 p-1 text-edge hover:text-content-3 cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>
      <div className={`flex-1 bg-surface border border-edge rounded-lg p-2 grid ${colClass} gap-2 relative`}>
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-surface border border-edge rounded text-[8px] text-content-3 px-1.5 py-0.5 whitespace-nowrap">
          {row.columns === 1 ? '1 col' : row.columns === 2 ? '2 cols' : '3 cols'}
        </span>
        {row.fields.map((field) => (
          <button
            key={field.id}
            onClick={() => onSelectField(selectedFieldId === field.id ? null : field.id, row.id)}
            className={`text-left rounded-md p-2 border text-xs transition-colors ${
              selectedFieldId === field.id
                ? 'border-brand bg-brand/10'
                : 'border-edge hover:border-brand/50 bg-background'
            }`}
          >
            {field.autoFillFrom && <span className="text-brand mr-1 text-[9px]">⚡</span>}
            <span className="text-[8px] uppercase tracking-wide text-content-3 block">{field.type}</span>
            <span className="text-content font-medium">{field.label || '(sin etiqueta)'}</span>
          </button>
        ))}
      </div>
      <button
        onClick={() => onDeleteRow(row.id)}
        className="mt-2 p-1 opacity-0 group-hover:opacity-100 text-danger hover:bg-danger-bg rounded transition-all"
      >
        <X size={13} />
      </button>
    </div>
  );
}

interface Props {
  rows: TemplateRow[];
  selectedFieldId: string | null;
  selectedRowId: string | null;
  onRowsChange: (rows: TemplateRow[]) => void;
  onSelectField: (fieldId: string | null, rowId: string | null) => void;
}

export default function BuilderCanvas({ rows, selectedFieldId, onRowsChange, onSelectField }: Props) {
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = rows.findIndex((r) => r.id === active.id);
      const newIndex = rows.findIndex((r) => r.id === over.id);
      onRowsChange(arrayMove(rows, oldIndex, newIndex));
    }
  }

  function handleDeleteRow(rowId: string) {
    onRowsChange(rows.filter((r) => r.id !== rowId));
    onSelectField(null, null);
  }

  return (
    <div className="flex-1 bg-background overflow-y-auto flex flex-col">
      <div className="p-3 flex flex-col gap-3 flex-1">
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {rows.map((row) => (
              <RowItem
                key={row.id}
                row={row}
                selectedFieldId={selectedFieldId}
                onSelectField={(fId, rId) => onSelectField(fId, rId)}
                onDeleteRow={handleDeleteRow}
              />
            ))}
          </SortableContext>
        </DndContext>

        {rows.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-content-3 text-sm border border-dashed border-edge rounded-xl">
            Haz click en un componente de la paleta para agregar campos
          </div>
        )}

        <button
          onClick={() => onSelectField(null, null)}
          className="flex items-center justify-center gap-1.5 py-2 border border-dashed border-edge rounded-lg text-xs text-content-3 hover:border-brand hover:text-brand transition-colors"
        >
          <Plus size={12} /> Agregar fila
        </button>
      </div>
    </div>
  );
}
