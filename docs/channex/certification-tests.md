# Channex PMS Certification — Test Reference

Use this doc to copy-paste values and follow UI steps for each certification test.
IDs below are from the most recently provisioned test property — update after each fresh setup.

## Section 2 — Property & Entity IDs

After running the setup wizard, note these IDs from the Step 4 confirmation screen:

| Entity | ID |
|--------|----|
| Property | `<channexPropertyId from wizard Step 4>` |
| Twin Room | `<roomTypeId>` |
| Double Room | `<roomTypeId>` |
| Twin Room / Best Available Rate | `<ratePlanId>` |
| Twin Room / Bed and Breakfast | `<ratePlanId>` |
| Double Room / Best Available Rate | `<ratePlanId>` |
| Double Room / Bed and Breakfast | `<ratePlanId>` |

---

## Test #1 — Full Sync (Section 4)

**UI path:** Channex tab → Properties → select property → ARI Calendar → "Full Sync (500 days)"

**Modal values:**
- Availability: `1`
- Rate: `100`
- Days: `500`

Click **Run Full Sync**. Note both task IDs shown in the emerald box.

---

## Test #2 — Single date / single rate (Section 6)

**UI path:** ARI Calendar → click Nov 22 → click Nov 22 again

**Panel values:**
- Room Type: Twin Room
- Rate Plan: Best Available Rate
- Rate: `333`
- Leave availability blank

Click **+ Add to Batch**, then **Save (1)**.

---

## Test #3 — Single date / multi-rate (Section 9)

Three separate panel saves on the same selection, then one batch save.

**Selection:** Click Nov 21 → click Nov 21

**Entry 1 — Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate | Rate: `333`
- Click **+ Add to Batch**

**Entry 2 — Change panel values (same date range stays selected):**
- Room Type: Double Room | Rate Plan: Best Available Rate | Rate: `444`
- Click **+ Add to Batch**

**Entry 3:**
- Room Type: Double Room | Rate Plan: Bed and Breakfast | Rate: `456.23`
- Click **+ Add to Batch**

Click **Save (3)** → 1 Channex API call with 3 restriction entries. Note task ID.

---

## Test #4 — Multi-date / multi-rate (Section 12)

Three ranges, each a separate add-to-batch.

**Entry 1:** Click Nov 14 → Nov 21 | Twin BAR | Rate: `500` → Add to Batch
**Entry 2:** Click Nov 22 → Nov 29 | Double BAR | Rate: `600` → Add to Batch
**Entry 3:** Click Dec 1 → Dec 7 | Double B&B | Rate: `700` → Add to Batch

Click **Save (3)**.

---

## Test #5 — Min Stay (Section 15)

**Selection:** Nov 1 → Nov 30

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- Min Stay: `3`

**+ Add to Batch → Save (1)**.

---

## Test #6 — Stop Sell (Section 18)

**Selection:** Dec 24 → Dec 26

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- ☑ Stop Sell

**+ Add to Batch → Save (1)**.

---

## Test #7 — Multiple restrictions (Section 21)

**Selection:** Nov 15 → Nov 15

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- ☑ Closed to Arrival | ☑ Closed to Departure | Min Stay: `2`

**+ Add to Batch → Save (1)**.

---

## Test #8 — Half-year update (Section 24)

**Selection:** Dec 1 2026 → May 1 2027 (navigate months with Prev/Next)

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- Rate: `250`
- ☑ Closed to Arrival | ☑ Closed to Departure | Min Stay: `5`

**+ Add to Batch → Save (1)**.

---

## Test #9 — Single date availability (Section 27)

**Entry 1:** Click Nov 21 → Nov 21 | Twin Room | Availability: `7` → Add to Batch
**Entry 2:** Click Nov 21 → Nov 21 | Double Room | Availability: `0` → Add to Batch

Click **Save (2)** → 1 Channex API call with 2 availability entries.

---

## Test #10 — Multi-date availability (Section 30)

**Entry 1:** Click Nov 10 → Nov 16 | Twin Room | Availability: `3` → Add to Batch
**Entry 2:** Click Nov 17 → Nov 24 | Double Room | Availability: `4` → Add to Batch

Click **Save (2)**.
