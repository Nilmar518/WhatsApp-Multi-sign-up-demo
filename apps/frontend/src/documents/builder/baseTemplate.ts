import type { TemplateRow } from '../api/documentBuilderApi';

export const BASE_FICHA_NAME = 'Ficha de Registro';

export const BASE_FICHA_ROWS: TemplateRow[] = [
  // Row 1: Fecha de Registro + N°
  {
    id: 'base-row-1',
    columns: 2,
    fields: [
      {
        id: 'base-f-fecha',
        type: 'date',
        label: 'FECHA DE REGISTRO',
        required: true,
        autoFillFrom: 'reservation.checkIn',
      },
      {
        id: 'base-f-num',
        type: 'auto-number',
        label: 'N°',
        required: false,
      },
    ],
  },

  // Row 2: Nombres
  {
    id: 'base-row-2',
    columns: 1,
    fields: [
      {
        id: 'base-f-nombres',
        type: 'text',
        label: 'NOMBRES',
        required: true,
        autoFillFrom: 'reservation.guestName',
      },
    ],
  },

  // Row 3: Lugar y Tipo de Habitación (checkbox-group)
  {
    id: 'base-row-3',
    columns: 1,
    fields: [
      {
        id: 'base-f-lugar',
        type: 'checkbox-group',
        label: 'LUGAR Y TIPO DE HABITACION',
        required: false,
        options: [
          'LOS POZOS BACKPACKER',
          'LOS POZOS FULL',
          'LOS POZOS EXPRESS',
          'LOS POZOS BLAN/34',
          'TORRE ARA Habitación 8A',
          'TORRE ARA-RB Habitación 12A',
          'TORRE ARA-RB Habitación 12B',
          'BARUC LIZ 22',
          'ANG ANG-1',
        ],
      },
    ],
  },

  // Row 4: Habitación
  {
    id: 'base-row-4',
    columns: 1,
    fields: [
      {
        id: 'base-f-habitacion',
        type: 'text',
        label: 'HABITACION',
        required: false,
        autoFillFrom: 'reservation.roomTypeId',
      },
    ],
  },

  // Row 5: Piso
  {
    id: 'base-row-5',
    columns: 1,
    fields: [
      {
        id: 'base-f-piso',
        type: 'text',
        label: 'PISO',
        required: false,
      },
    ],
  },

  // Row 6: Forma y Monto de Cobro (checkbox-amount)
  {
    id: 'base-row-6',
    columns: 1,
    fields: [
      {
        id: 'base-f-cobro',
        type: 'checkbox-amount',
        label: 'FORMA Y MONTO DE COBRO',
        required: true,
        options: [
          'EFECTIVO BOLIVIANOS',
          'BANCO BOLIVIANOS',
          'EFECTIVO DOLARES',
          'BANCO DOLARES',
        ],
      },
    ],
  },

  // Row 7: Cantidad de Noches
  {
    id: 'base-row-7',
    columns: 1,
    fields: [
      {
        id: 'base-f-noches',
        type: 'number',
        label: 'CANTIDAD DE NOCHES',
        required: true,
        suffix: 'Noche(s)',
        autoFillFrom: 'reservation.nights',
      },
    ],
  },

  // Row 8: Aplicativo (canal)
  {
    id: 'base-row-8',
    columns: 1,
    fields: [
      {
        id: 'base-f-aplicativo',
        type: 'checkbox-group',
        label: 'APLICATIVO',
        required: false,
        options: ['EXTERNO', 'BOOKING', 'AIRBNB'],
      },
    ],
  },
];
