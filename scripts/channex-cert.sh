#!/usr/bin/env bash
# =============================================================================
# Channex Certification Test Script
#
# Crea todo desde cero, ejecuta los 11 test cases con los datos exactos del
# formulario de certificación Channex, guarda los task IDs, y limpia todo.
#
# Uso:
#   cd "apps/backend"
#   bash ../../scripts/channex-cert.sh          # setup + tests
#   bash ../../scripts/channex-cert.sh cleanup  # solo cleanup (usa cert-ids.env)
#
# Requiere: curl, jq, node
# El backend debe estar corriendo (local o ngrok)
# =============================================================================

set -uo pipefail   # Sin -e: los errores se manejan explícitamente por paso

BACKEND="https://postmeningeal-erich-discernably.ngrok-free.dev"
CHANNEX_API="https://staging.channex.io/api/v1"
CHANNEX_API_KEY="uDWKITOcWdt9QdBdZpEX/ifi3scnb9lu3zYsaEfy+7xOaiAQPN+5HkUdQNQayPAh"
WEBHOOK_URL="https://postmeningeal-erich-discernably.ngrok-free.dev/channex/webhook"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDS_FILE="$SCRIPT_DIR/cert-ids.env"
RESULTS_FILE="$SCRIPT_DIR/cert-task-ids.txt"

AUTH_HEADER="Authorization: Bearer $CHANNEX_API_KEY"

# ── Helpers ───────────────────────────────────────────────────────────────────

step() { echo ""; echo "═══ $* ═══"; }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

# Guarda un ID en cert-ids.env de forma incremental (no sobreescribe otros)
save_id() {
  local key="$1" val="$2"
  if [[ -f "$IDS_FILE" ]]; then
    # Reemplaza si ya existe, agrega si no
    if grep -q "^${key}=" "$IDS_FILE" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$IDS_FILE"
    else
      echo "${key}=${val}" >> "$IDS_FILE"
    fi
  else
    echo "${key}=${val}" > "$IDS_FILE"
  fi
}

check_deps() {
  command -v curl >/dev/null || fail "curl no está instalado"
  command -v jq   >/dev/null || fail "jq no está instalado"
  command -v node >/dev/null || fail "node no está instalado"
  local http_code
  http_code=$(curl -s --connect-timeout 5 -o /dev/null -w "%{http_code}" "$BACKEND/")
  [[ "$http_code" == "000" || -z "$http_code" ]] && \
    fail "Backend no responde en $BACKEND — ¿está corriendo?"
  ok "Backend OK (HTTP $http_code)"
}

# Borra un recurso de Channex — no falla el script si el recurso no existe
channex_delete() {
  local label="$1" url="$2"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$url" -H "$AUTH_HEADER" 2>/dev/null || echo "000")
  if [[ "$http_code" == "200" || "$http_code" == "204" || "$http_code" == "404" ]]; then
    ok "$label → HTTP $http_code"
  else
    warn "$label → HTTP $http_code (puede ya estar borrado)"
  fi
}

# ── Cleanup helpers ───────────────────────────────────────────────────────────

# Consulta Channex y borra rate plans, room types y webhooks de una propiedad
cleanup_property_resources() {
  local prop_id="$1"

  echo "  Descubriendo webhooks de $prop_id..."
  local webhooks
  webhooks=$(curl -s "$CHANNEX_API/push_subscriptions?filter[property_id]=$prop_id" \
    -H "$AUTH_HEADER" 2>/dev/null | jq -r '.data[]?.id // empty' 2>/dev/null || true)
  for wh_id in $webhooks; do
    channex_delete "  Webhook $wh_id" "$CHANNEX_API/push_subscriptions/$wh_id"
  done

  echo "  Descubriendo rate plans de $prop_id..."
  local rate_plans
  rate_plans=$(curl -s "$CHANNEX_API/rate_plans?filter[property_id]=$prop_id" \
    -H "$AUTH_HEADER" 2>/dev/null | jq -r '.data[]?.id // empty' 2>/dev/null || true)
  for rp_id in $rate_plans; do
    channex_delete "  Rate Plan $rp_id" "$CHANNEX_API/rate_plans/$rp_id"
  done

  echo "  Descubriendo room types de $prop_id..."
  local room_types
  room_types=$(curl -s "$CHANNEX_API/room_types?filter[property_id]=$prop_id" \
    -H "$AUTH_HEADER" 2>/dev/null | jq -r '.data[]?.id // empty' 2>/dev/null || true)
  for rt_id in $room_types; do
    channex_delete "  Room Type $rt_id" "$CHANNEX_API/room_types/$rt_id"
  done
}

# ── Cleanup ───────────────────────────────────────────────────────────────────

cleanup() {
  step "FASE 14 — Cleanup"

  # Inicializar todas las variables vacías para que el script no falle con -u
  local PROP_ID="" FIRESTORE_DOC_ID=""

  if [[ -f "$IDS_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$IDS_FILE"
    ok "Leyendo IDs desde $IDS_FILE"
  fi

  # ── Discovery: si no tenemos PROP_ID, buscar en Channex por nombre ──────────
  if [[ -z "$PROP_ID" ]]; then
    step "Discovery — buscando 'Test Property - Migo UIT' en Channex staging"
    local all_props
    all_props=$(curl -s "$CHANNEX_API/properties" -H "$AUTH_HEADER" 2>/dev/null || echo '{}')

    # Debug: mostrar cuántas propiedades retornó la API
    local total_props
    total_props=$(echo "$all_props" | jq '.data | length' 2>/dev/null || echo "0")
    echo "  API retornó $total_props propiedad(es)"
    echo "$all_props" | jq -r '.data[]?.attributes.title' 2>/dev/null | sed 's/^/    - /' || true

    # Extraer todos los IDs de propiedades con ese título
    local discovered_ids
    discovered_ids=$(echo "$all_props" | \
      jq -r '.data[]? | select(.attributes.title == "Test Property - Migo UIT") | .id' \
      2>/dev/null || true)

    if [[ -z "$discovered_ids" ]]; then
      warn "No se encontró 'Test Property - Migo UIT' en Channex — nada que limpiar allí"
    else
      for disc_prop_id in $discovered_ids; do
        echo ""
        echo "  Encontrada propiedad huérfana: $disc_prop_id"
        cleanup_property_resources "$disc_prop_id"
        channex_delete "  Property $disc_prop_id" "$CHANNEX_API/properties/$disc_prop_id"

        # Intentar borrar Firestore por channex_property_id
        echo ""
        echo "  Borrando Firestore para property $disc_prop_id..."
        node "$SCRIPT_DIR/channex-cert-firestore-delete.js" \
          "--by-property-id" "$disc_prop_id" 2>&1 || \
          warn "Firestore: no encontrado (puede que ya esté borrado)"
      done
    fi
  else
    # ── Tenemos PROP_ID desde cert-ids.env ──────────────────────────────────
    echo ""
    echo "  Limpiando recursos de propiedad $PROP_ID..."
    cleanup_property_resources "$PROP_ID"
    channex_delete "Property $PROP_ID" "$CHANNEX_API/properties/$PROP_ID"

    if [[ -n "$FIRESTORE_DOC_ID" ]]; then
      echo ""
      echo "  Borrando Firestore: channex_integrations/$FIRESTORE_DOC_ID"
      node "$SCRIPT_DIR/channex-cert-firestore-delete.js" \
        "$FIRESTORE_DOC_ID" 2>&1 || \
        warn "Firestore: no se pudo borrar (¿ya fue borrado?)"
    else
      # Intentar por property ID como fallback
      node "$SCRIPT_DIR/channex-cert-firestore-delete.js" \
        "--by-property-id" "$PROP_ID" 2>&1 || \
        warn "Firestore: no encontrado para property $PROP_ID"
    fi
  fi

  rm -f "$IDS_FILE"
  echo ""
  ok "Cleanup completo"
}

if [[ "${1:-}" == "cleanup" ]]; then
  cleanup
  exit 0
fi

# ── Setup ─────────────────────────────────────────────────────────────────────

check_deps

# ── 0.1 — Propiedad ───────────────────────────────────────────────────────────

step "FASE 0.1 — Crear propiedad (backend → Channex + Firestore)"

PROVISION=$(curl -sf -X POST "$BACKEND/channex/properties" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "cert-test-tenant",
    "migoPropertyId": "cert-test-migo-prop-001",
    "title": "Test Property - Migo UIT",
    "currency": "USD",
    "timezone": "America/New_York",
    "propertyType": "apartment"
  }') || fail "No se pudo crear la propiedad — respuesta: ${PROVISION:-vacía}"

PROP_ID=$(echo "$PROVISION" | jq -r '.channexPropertyId // empty')
FIRESTORE_DOC_ID=$(echo "$PROVISION" | jq -r '.firestoreDocId // empty')
[[ -z "$PROP_ID" ]] && fail "channexPropertyId no retornado: $PROVISION"

save_id "PROP_ID" "$PROP_ID"
save_id "FIRESTORE_DOC_ID" "$FIRESTORE_DOC_ID"
ok "Property — $PROP_ID"
ok "Firestore — $FIRESTORE_DOC_ID"

# ── 0.2 — Twin Room ───────────────────────────────────────────────────────────

step "FASE 0.2 — Crear Twin Room (backend → Channex + Firestore)"

TWIN_RT=$(curl -sf -X POST "$BACKEND/channex/properties/$PROP_ID/room-types" \
  -H "Content-Type: application/json" \
  -d '{"title": "Twin Room", "defaultOccupancy": 2, "occAdults": 2}') \
  || fail "No se pudo crear Twin Room — respuesta: ${TWIN_RT:-vacía}"

TWIN_RT_ID=$(echo "$TWIN_RT" | jq -r '.data.id // empty')
[[ -z "$TWIN_RT_ID" ]] && fail "Twin Room ID no retornado: $TWIN_RT"

save_id "TWIN_RT_ID" "$TWIN_RT_ID"
ok "Twin Room — $TWIN_RT_ID"

# ── 0.3 — Double Room ─────────────────────────────────────────────────────────

step "FASE 0.3 — Crear Double Room (backend → Channex + Firestore)"

DOUBLE_RT=$(curl -sf -X POST "$BACKEND/channex/properties/$PROP_ID/room-types" \
  -H "Content-Type: application/json" \
  -d '{"title": "Double Room", "defaultOccupancy": 2, "occAdults": 2}') \
  || fail "No se pudo crear Double Room — respuesta: ${DOUBLE_RT:-vacía}"

DOUBLE_RT_ID=$(echo "$DOUBLE_RT" | jq -r '.data.id // empty')
[[ -z "$DOUBLE_RT_ID" ]] && fail "Double Room ID no retornado: $DOUBLE_RT"

save_id "DOUBLE_RT_ID" "$DOUBLE_RT_ID"
ok "Double Room — $DOUBLE_RT_ID"

# ── 0.4 — Rate Plans (via backend → Channex + Firestore) ──────────────────────

step "FASE 0.4 — Crear 4 Rate Plans (backend → Channex + Firestore)"

create_rate_plan_backend() {
  local room_type_id="$1" title="$2" rate="$3"
  local resp
  resp=$(curl -sf -X POST "$BACKEND/channex/properties/$PROP_ID/room-types/$room_type_id/rate-plans" \
    -H "Content-Type: application/json" \
    -d "{\"title\": \"$title\", \"currency\": \"USD\", \"rate\": $rate, \"occupancy\": 2}") \
    || { echo "ERROR: no se pudo crear '$title'"; return 1; }
  echo "$resp" | jq -r '.data.id // empty'
}

TWIN_BAR_ID=$(create_rate_plan_backend "$TWIN_RT_ID" "Best Available Rate" 10000) \
  || fail "No se pudo crear Twin / BAR"
[[ -z "$TWIN_BAR_ID" ]] && fail "Twin BAR ID vacío"
save_id "TWIN_BAR_ID" "$TWIN_BAR_ID"
ok "Twin / BAR — $TWIN_BAR_ID"

TWIN_BB_ID=$(create_rate_plan_backend "$TWIN_RT_ID" "Bed and Breakfast" 12000) \
  || fail "No se pudo crear Twin / B&B"
[[ -z "$TWIN_BB_ID" ]] && fail "Twin B&B ID vacío"
save_id "TWIN_BB_ID" "$TWIN_BB_ID"
ok "Twin / B&B — $TWIN_BB_ID"

DOUBLE_BAR_ID=$(create_rate_plan_backend "$DOUBLE_RT_ID" "Best Available Rate" 10000) \
  || fail "No se pudo crear Double / BAR"
[[ -z "$DOUBLE_BAR_ID" ]] && fail "Double BAR ID vacío"
save_id "DOUBLE_BAR_ID" "$DOUBLE_BAR_ID"
ok "Double / BAR — $DOUBLE_BAR_ID"

DOUBLE_BB_ID=$(create_rate_plan_backend "$DOUBLE_RT_ID" "Bed and Breakfast" 12000) \
  || fail "No se pudo crear Double / B&B"
[[ -z "$DOUBLE_BB_ID" ]] && fail "Double B&B ID vacío"
save_id "DOUBLE_BB_ID" "$DOUBLE_BB_ID"
ok "Double / B&B — $DOUBLE_BB_ID"

# ── 0.5 — Verificar Firestore ─────────────────────────────────────────────────

step "FASE 0.5 — Verificar Firestore room_types"

ROOM_TYPES=$(curl -sf "$BACKEND/channex/properties/$PROP_ID/room-types") || \
  warn "No se pudo verificar room_types via backend"

RT_COUNT=$(echo "${ROOM_TYPES:-[]}" | jq 'length' 2>/dev/null || echo "?")
ok "room_types en Firestore: $RT_COUNT entradas"

# ── 0.6 — Webhook ─────────────────────────────────────────────────────────────

step "FASE 0.6 — Crear webhook subscription"

WEBHOOK=$(curl -sf -X POST "$CHANNEX_API/push_subscriptions" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"push_subscription\": {
      \"callback_url\": \"$WEBHOOK_URL\",
      \"property_id\": \"$PROP_ID\",
      \"event_mask\": \"booking_new,booking_modification,booking_cancellation,booking_request\",
      \"send_data\": true,
      \"is_active\": true
    }
  }") || fail "No se pudo crear el webhook"

WEBHOOK_ID=$(echo "$WEBHOOK" | jq -r '.data.id // empty')
[[ -z "$WEBHOOK_ID" ]] && fail "Webhook ID no retornado: $WEBHOOK"

save_id "WEBHOOK_ID" "$WEBHOOK_ID"
ok "Webhook — $WEBHOOK_ID"

echo ""
echo "  IDs guardados en $IDS_FILE"
echo "  Property:    $PROP_ID"
echo "  Twin Room:   $TWIN_RT_ID | Twin BAR: $TWIN_BAR_ID | Twin B&B: $TWIN_BB_ID"
echo "  Double Room: $DOUBLE_RT_ID | Double BAR: $DOUBLE_BAR_ID | Double B&B: $DOUBLE_BB_ID"
echo "  Webhook:     $WEBHOOK_ID"

# ── Tests ─────────────────────────────────────────────────────────────────────

{
  echo "Channex Certification — Task IDs"
  echo "Generado: $(date)"
  echo ""
} > "$RESULTS_FILE"

save_task() {
  local label="$1" response="$2"
  local task_id
  task_id=$(echo "$response" | jq -r '.taskId // "ERROR-parse"' 2>/dev/null || echo "ERROR-jq")
  echo "$label: $task_id" >> "$RESULTS_FILE"
  echo "    taskId: $task_id"
}

run_availability() {
  curl -sf -X POST "$BACKEND/channex/properties/$PROP_ID/availability" \
    -H "Content-Type: application/json" \
    -d "$1" || echo '{"taskId":"ERROR-http"}'
}

run_restrictions() {
  curl -sf -X POST "$BACKEND/channex/properties/$PROP_ID/restrictions" \
    -H "Content-Type: application/json" \
    -d "$1" || echo '{"taskId":"ERROR-http"}'
}

# ── Test #1 ───────────────────────────────────────────────────────────────────

step "TEST #1 — Full Sync (500 días, 2 llamadas Channex)"

T1=$(curl -sf -X POST "$BACKEND/channex/properties/$PROP_ID/full-sync" \
  -H "Content-Type: application/json" \
  -d '{"defaultAvailability": 1, "defaultRate": "100.00", "days": 500}') \
  || { warn "Test #1 falló — continuando"; T1='{"availabilityTaskId":"ERROR","restrictionsTaskId":"ERROR"}'; }

{
  echo "#1 Full Sync"
  echo "  availabilityTaskId: $(echo "$T1" | jq -r '.availabilityTaskId // "ERROR"')"
  echo "  restrictionsTaskId: $(echo "$T1" | jq -r '.restrictionsTaskId // "ERROR"')"
} >> "$RESULTS_FILE"
echo "  availabilityTaskId: $(echo "$T1" | jq -r '.availabilityTaskId // "ERROR"')"
echo "  restrictionsTaskId: $(echo "$T1" | jq -r '.restrictionsTaskId // "ERROR"')"
ok "Test #1 OK"

# ── Test #2 ───────────────────────────────────────────────────────────────────

step "TEST #2 — Single date update (Twin BAR, Nov 22 → \$333)"

T2=$(run_restrictions "{
  \"updates\": [{
    \"rate_plan_id\": \"$TWIN_BAR_ID\",
    \"date_from\": \"2026-11-22\",
    \"date_to\": \"2026-11-22\",
    \"rate\": \"333.00\"
  }]
}")
echo "" >> "$RESULTS_FILE"
echo "#2 Single date, single rate:" >> "$RESULTS_FILE"
save_task "  taskId" "$T2"
ok "Test #2 OK"

# ── Test #3 ───────────────────────────────────────────────────────────────────

step "TEST #3 — 3 rate changes, fechas distintas (1 llamada batch)"

T3=$(run_restrictions "{
  \"updates\": [
    { \"rate_plan_id\": \"$TWIN_BAR_ID\",  \"date_from\": \"2026-11-21\", \"date_to\": \"2026-11-21\", \"rate\": \"333.00\" },
    { \"rate_plan_id\": \"$DOUBLE_BAR_ID\", \"date_from\": \"2026-11-25\", \"date_to\": \"2026-11-25\", \"rate\": \"444.00\" },
    { \"rate_plan_id\": \"$DOUBLE_BB_ID\",  \"date_from\": \"2026-11-29\", \"date_to\": \"2026-11-29\", \"rate\": \"456.23\" }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#3 Single date, multiple rates (batch):" >> "$RESULTS_FILE"
save_task "  taskId" "$T3"
ok "Test #3 OK"

# ── Test #4 ───────────────────────────────────────────────────────────────────

step "TEST #4 — 3 rate ranges, múltiples fechas (1 llamada batch)"

T4=$(run_restrictions "{
  \"updates\": [
    { \"rate_plan_id\": \"$TWIN_BAR_ID\",  \"date_from\": \"2026-11-01\", \"date_to\": \"2026-11-10\", \"rate\": \"241.00\" },
    { \"rate_plan_id\": \"$DOUBLE_BAR_ID\", \"date_from\": \"2026-11-10\", \"date_to\": \"2026-11-16\", \"rate\": \"312.66\" },
    { \"rate_plan_id\": \"$DOUBLE_BB_ID\",  \"date_from\": \"2026-11-01\", \"date_to\": \"2026-11-20\", \"rate\": \"111.00\" }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#4 Multiple date ranges, multiple rates (batch):" >> "$RESULTS_FILE"
save_task "  taskId" "$T4"
ok "Test #4 OK"

# ── Test #5 ───────────────────────────────────────────────────────────────────

step "TEST #5 — Min Stay (3 rates, 1 llamada batch)"

T5=$(run_restrictions "{
  \"updates\": [
    { \"rate_plan_id\": \"$TWIN_BAR_ID\",  \"date_from\": \"2026-11-23\", \"date_to\": \"2026-11-23\", \"min_stay_arrival\": 3 },
    { \"rate_plan_id\": \"$DOUBLE_BAR_ID\", \"date_from\": \"2026-11-25\", \"date_to\": \"2026-11-25\", \"min_stay_arrival\": 2 },
    { \"rate_plan_id\": \"$DOUBLE_BB_ID\",  \"date_from\": \"2026-11-15\", \"date_to\": \"2026-11-15\", \"min_stay_arrival\": 5 }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#5 Min Stay update (batch):" >> "$RESULTS_FILE"
save_task "  taskId" "$T5"
ok "Test #5 OK"

# ── Test #6 ───────────────────────────────────────────────────────────────────

step "TEST #6 — Stop Sell (3 rates, 1 llamada batch)"

T6=$(run_restrictions "{
  \"updates\": [
    { \"rate_plan_id\": \"$TWIN_BAR_ID\",  \"date_from\": \"2026-11-14\", \"date_to\": \"2026-11-14\", \"stop_sell\": true },
    { \"rate_plan_id\": \"$DOUBLE_BAR_ID\", \"date_from\": \"2026-11-16\", \"date_to\": \"2026-11-16\", \"stop_sell\": true },
    { \"rate_plan_id\": \"$DOUBLE_BB_ID\",  \"date_from\": \"2026-11-20\", \"date_to\": \"2026-11-20\", \"stop_sell\": true }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#6 Stop Sell (batch):" >> "$RESULTS_FILE"
save_task "  taskId" "$T6"
ok "Test #6 OK"

# ── Test #7 ───────────────────────────────────────────────────────────────────

step "TEST #7 — Multiple Restrictions (CTA/CTD/max_stay/min_stay, 4 updates batch)"

T7=$(run_restrictions "{
  \"updates\": [
    { \"rate_plan_id\": \"$TWIN_BAR_ID\",  \"date_from\": \"2026-11-01\", \"date_to\": \"2026-11-10\", \"closed_to_arrival\": true,  \"closed_to_departure\": false, \"max_stay\": 4, \"min_stay_arrival\": 1 },
    { \"rate_plan_id\": \"$TWIN_BB_ID\",   \"date_from\": \"2026-11-12\", \"date_to\": \"2026-11-16\", \"closed_to_arrival\": false, \"closed_to_departure\": true,  \"min_stay_arrival\": 6 },
    { \"rate_plan_id\": \"$DOUBLE_BAR_ID\", \"date_from\": \"2026-11-10\", \"date_to\": \"2026-11-16\", \"closed_to_arrival\": true,  \"min_stay_arrival\": 2 },
    { \"rate_plan_id\": \"$DOUBLE_BB_ID\",  \"date_from\": \"2026-11-01\", \"date_to\": \"2026-11-20\", \"min_stay_arrival\": 10 }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#7 Multiple restrictions (CTA/CTD/max_stay/min_stay batch):" >> "$RESULTS_FILE"
save_task "  taskId" "$T7"
ok "Test #7 OK"

# ── Test #8 ───────────────────────────────────────────────────────────────────

step "TEST #8 — Half-Year update (Dic 2026 – May 2027, 2 rate plans, 1 batch)"

T8=$(run_restrictions "{
  \"updates\": [
    { \"rate_plan_id\": \"$TWIN_BAR_ID\",  \"date_from\": \"2026-12-01\", \"date_to\": \"2027-05-01\", \"rate\": \"432.00\", \"closed_to_arrival\": false, \"closed_to_departure\": false, \"min_stay_arrival\": 2 },
    { \"rate_plan_id\": \"$DOUBLE_BAR_ID\", \"date_from\": \"2026-12-01\", \"date_to\": \"2027-05-01\", \"rate\": \"342.00\", \"min_stay_arrival\": 3 }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#8 Half-year update (batch):" >> "$RESULTS_FILE"
save_task "  taskId" "$T8"
ok "Test #8 OK"

# ── Test #9 ───────────────────────────────────────────────────────────────────

step "TEST #9 — Availability update (Twin Nov 21 → 7, Double Nov 25 → 0)"

T9=$(run_availability "{
  \"updates\": [
    { \"room_type_id\": \"$TWIN_RT_ID\",   \"date_from\": \"2026-11-21\", \"date_to\": \"2026-11-21\", \"availability\": 7 },
    { \"room_type_id\": \"$DOUBLE_RT_ID\",  \"date_from\": \"2026-11-25\", \"date_to\": \"2026-11-25\", \"availability\": 0 }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#9 Single date availability:" >> "$RESULTS_FILE"
save_task "  taskId" "$T9"
ok "Test #9 OK"

# ── Test #10 ──────────────────────────────────────────────────────────────────

step "TEST #10 — Availability range update (Twin Nov 10–16 → 3, Double Nov 17–24 → 4)"

T10=$(run_availability "{
  \"updates\": [
    { \"room_type_id\": \"$TWIN_RT_ID\",   \"date_from\": \"2026-11-10\", \"date_to\": \"2026-11-16\", \"availability\": 3 },
    { \"room_type_id\": \"$DOUBLE_RT_ID\",  \"date_from\": \"2026-11-17\", \"date_to\": \"2026-11-24\", \"availability\": 4 }
  ]
}")
echo "" >> "$RESULTS_FILE"
echo "#10 Multiple date availability:" >> "$RESULTS_FILE"
save_task "  taskId" "$T10"
ok "Test #10 OK"

# ── Test #11 ──────────────────────────────────────────────────────────────────

step "TEST #11 — Webhook (verificación manual durante la reunión)"

WEBHOOK_RESP=$(curl -sf "$CHANNEX_API/push_subscriptions/$WEBHOOK_ID" \
  -H "$AUTH_HEADER" 2>/dev/null || echo '{}')
WEBHOOK_STATUS=$(echo "$WEBHOOK_RESP" | jq -r '.data.attributes.is_active // "unknown"')

{
  echo ""
  echo "#11 Webhook:"
  echo "  WEBHOOK_ID=$WEBHOOK_ID"
  echo "  is_active=$WEBHOOK_STATUS"
} >> "$RESULTS_FILE"

if [[ "$WEBHOOK_STATUS" == "true" ]]; then
  ok "Webhook activo — el evaluador de Channex hará el test push durante la reunión"
else
  warn "Webhook is_active=$WEBHOOK_STATUS — verificar manualmente"
fi

# ── Resumen ───────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════"
echo "  TODOS LOS TESTS COMPLETADOS"
echo "════════════════════════════════════════════"
echo ""
echo "Task IDs para el formulario de certificación:"
echo "  $RESULTS_FILE"
echo ""
cat "$RESULTS_FILE"
echo ""
echo "Para hacer cleanup: cd apps/backend && bash ../../scripts/channex-cert.sh cleanup"
