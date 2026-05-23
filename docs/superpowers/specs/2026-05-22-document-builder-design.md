# Document Builder — Design Spec
**Date:** 2026-05-22  
**Status:** Approved

---

## Overview

A dynamic document builder that lets hotel administrators configure a registration form ("Ficha de Registro"), fill it out digitally per reservation, save it to Firestore, and export it as a PDF. The system is multi-tenant, editable, and integrated into the existing reservation detail modal.

**Scope (v1):** One document type — Ficha de Registro (check-in). The architecture supports additional templates in the future without structural changes.

---

## Mode

**Hybrid:** The form is filled digitally in the app (values persisted to Firestore) and can also be exported/printed as a PDF. Both the digital record and the printable version are first-class outputs.

---

## Access Points

1. **`/documentos` section** — standalone page in the side navigation. Used to:
   - Configure the Ficha de Registro template (drag-and-drop builder)
   - View the full history of all generated documents
   - Create one-off documents not tied to a reservation (`isUnique: true`)

2. **Reservation detail modal** — new "Documentos" section appended to the existing `ReservationDetailModal`. Shows the Ficha de Registro with a "Llenar →" button. Visibility is controlled per template by `showOn` (list of statuses) or `"always"`. After completion, shows a summary with Ver / Editar / Exportar PDF actions.

---

## Firestore Collections

### `documentTemplates/{templateId}`

Stores the form schema. One document per template configuration.

```ts
{
  id: string;
  businessId: string;             // multi-tenant key
  name: string;                   // "Ficha de Registro"
  type: "check-in" | "custom";   // v1: always "check-in"
  showOn: string[] | "always";   // e.g. ["confirmed"] or "always"
  isUnique: boolean;              // true = one-off, not a reusable template
  rows: TemplateRow[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `TemplateRow`

```ts
{
  id: string;       // uuid
  columns: 1 | 2 | 3;
  fields: TemplateField[];
}
```

### `TemplateField`

```ts
{
  id: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "checkbox-group"
    | "checkbox-amount"
    | "auto-number"
    | "section-header"
    | "signature"
    | "bullet-list";
  label: string;
  required: boolean;
  options?: string[];        // checkbox-group, checkbox-amount
  suffix?: string;           // number — e.g. "Noche(s)"
  autoFillFrom?:             // pre-fill from reservation data
    | "reservation.guestName"
    | "reservation.roomNumber"
    | "reservation.checkIn"
    | "reservation.checkOut"
    | "reservation.nights"
    | "reservation.channel";
}
```

### `documentInstances/{instanceId}`

Stores a filled document. One document per form submission.

```ts
{
  id: string;
  businessId: string;
  templateId: string | null;    // null if isUnique
  reservationId?: string;
  values: Record<string, unknown>; // fieldId → value
  docNumber: number;             // auto-incremented per businessId via Firestore counter doc at counters/docNumber_{businessId}
  status: "draft" | "completed";
  createdBy: string;             // userId
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## Backend — NestJS Module: `document-builder`

New module at `apps/backend/src/document-builder/`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/document-builder/templates?businessId=` | List all templates for a business |
| `POST` | `/document-builder/templates` | Create a new template |
| `PUT`  | `/document-builder/templates/:id` | Update template (schema + config) |
| `DELETE` | `/document-builder/templates/:id` | Delete a template |
| `GET`  | `/document-builder/instances?businessId=&reservationId=` | List instances (filterable) |
| `POST` | `/document-builder/instances` | Create a new document instance |
| `PUT`  | `/document-builder/instances/:id` | Update/complete an instance |
| `DELETE` | `/document-builder/instances/:id` | Delete an instance |
| `POST` | `/document-builder/instances/:id/pdf` | Generate and return PDF |

### PDF Generation

- Uses **Puppeteer** (headless Chrome) on the backend.
- The endpoint renders an HTML template populated with instance values, then returns a PDF binary (`application/pdf`).
- The frontend triggers a file download on receipt.
- The HTML template mirrors the visual layout of the filled form (rows/columns, labels, values).

---

## Frontend

### Routing

New route `/documentos` added to `main.tsx` (same pathname pattern as existing routes). Renders `<DocumentsPage />`.

### File Structure

```
src/
└── documents/
    ├── DocumentsPage.tsx              ← index: template list + instance history
    ├── builder/
    │   ├── TemplateBuilder.tsx        ← drag-and-drop canvas (3-panel layout)
    │   ├── FieldPalette.tsx           ← left panel: 10 component types
    │   ├── BuilderCanvas.tsx          ← center panel: rows + fields
    │   └── FieldConfigPanel.tsx       ← right panel: field settings
    ├── filler/
    │   ├── DocumentFiller.tsx         ← form rendered from template schema
    │   └── FilledDocumentView.tsx     ← read-only view of completed document
    └── api/
        └── documentBuilderApi.ts      ← fetch wrappers for all endpoints
```

### Drag-and-Drop

- Library: **`@dnd-kit/core`** + **`@dnd-kit/sortable`** — new dependency, needs `pnpm --filter @migo-uit/frontend add @dnd-kit/core @dnd-kit/sortable`.
- **Row reorder:** drag by the `⠿` handle on the left of each row.
- **Field placement:** drag from palette → drop onto a row slot or onto "Add row" zone.
- Each row has 1, 2, or 3 column slots. Column count is set in the field config panel.

### Field Config Panel

Appears when a field is selected on the canvas. Controls:
- Field type (changes the component)
- Label text
- Required toggle
- `autoFillFrom` selector (for eligible field types)
- Column count for the parent row
- Options list (for checkbox-group and checkbox-amount)
- Suffix text (for number fields)
- Delete field button

### Template Config (bottom of palette)

- Template name
- Type: `check-in` | `custom`
- `showOn`: multi-select of reservation statuses OR "always"

---

## Integration with ReservationDetailModal

- A new `DocumentsSection` component is appended inside the existing `ReservationDetailModal` body, after the Notes section.
- On mount, it fetches templates for the `businessId` and the single matching instance for `reservationId` (if any).
- Each template is shown as a row with:
  - Status badge: "Pendiente" (yellow) or "✓ Completado #N" (green)
  - "Llenar →" button (if pending) or Ver / Editar / Exportar PDF (if completed)
  - Greyed out with "No aplica aún" if current reservation status is not in `showOn`
- Clicking "Llenar →" renders `<DocumentFiller />` as an overlay modal (stacked above `ReservationDetailModal`).
- On save, the `DocumentsSection` re-fetches and updates in place.

### Auto-fill mapping

When opening the filler from a reservation, `autoFillFrom` fields are pre-populated:

| `autoFillFrom` value | Source field on `Reservation` |
|---------------------|-------------------------------|
| `reservation.guestName` | `guest_first_name + guest_last_name` or `customer_name` |
| `reservation.roomTypeId` | `room_type_id` — raw UUID; `DocumentFiller` resolves the display title from the property's `room_types` array passed via prop |
| `reservation.checkIn` | `check_in` |
| `reservation.checkOut` | `check_out` |
| `reservation.nights` | `count_of_nights` or computed from `check_in`/`check_out` |
| `reservation.channel` | `channel_name` |

Auto-filled fields are rendered as read-only with a blue ⚡ indicator.

---

## Scope Constraints (v1)

- One template type implemented: **Ficha de Registro** (check-in).
- The data model and UI support additional templates — adding more is a config-only change.
- No real-time collaborative editing (single user fills at a time).
- PDF is generated server-side via Puppeteer; no client-side PDF generation.
- Signature field in v1 is a visual line for manual signing on print — no digital signature capture.
- `bullet-list` field values are stored as `string[]` (user adds items at fill time).

---

## Navigation

New entry in `SideNav` under the existing items:

```
📄 Documentos  →  /documentos
```
