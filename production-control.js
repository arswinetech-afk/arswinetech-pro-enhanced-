/*
 * ARSwineTech Pro — structured production control layer.
 *
 * This is an additive bridge over the legacy farm bucket. It introduces:
 *   1. Canonical production events with stable IDs and idempotency keys.
 *   2. Standardized KPI calculations with data-quality warnings.
 *   3. Actual feed delivery/consumption allocation and weighted-average costing.
 *   4. Append-only application audit records and non-destructive event voiding.
 *   5. A CSV/integration boundary for RFID, scales, feed mills and future APIs.
 *
 * Safety:
 *   • Existing records are read, never rewritten during KPI calculation.
 *   • Legacy records are represented as derived events until an operator records
 *     or imports a canonical event.
 *   • No automatic backfill runs on boot.
 *   • Deletes are audited by the save hook; canonical events are voided by a
 *     compensating event rather than removed from the event ledger.
 */
(function () {
  'use strict';

  const APP_VERSION = '2026.08-production-intelligence-2';
  const EVENT_TYPES = {
    birth: 'Birth / farrowing',
    service: 'Service / insemination',
    pregnancy_check: 'Pregnancy check',
    farrowing: 'Farrowing',
    weaning: 'Weaning',
    foster_out: 'Foster out',
    foster_in: 'Foster in',
    mortality: 'Mortality',
    sale: 'Animal sale',
    transfer_in: 'Transfer in',
    transfer_out: 'Transfer out',
    treatment: 'Treatment',
    vaccination: 'Vaccination',
    movement: 'Barn / pen movement',
    feed_order: 'Feed order',
    feed_delivery: 'Feed delivery',
    feed_consumption: 'Feed consumption',
    semen_collection: 'Semen collection',
    semen_use: 'Semen use',
    financial_transaction: 'Financial transaction',
    inventory_adjustment: 'Inventory adjustment',
    event_voided: 'Event voided',
    custom: 'Custom event'
  };

  const KPI_DEFINITIONS = {
    farrowing_rate: { label: 'Farrowing rate', formula: 'Farrowings ÷ services', note: 'A service must be recorded before it can be a denominator.' },
    preweaning_mortality_rate: { label: 'Pre-weaning mortality', formula: 'Mortality heads ÷ born heads', note: 'Only dated birth/farrowing and mortality events are included.' },
    average_born_per_farrowing: { label: 'Average born per farrowing', formula: 'Born heads ÷ farrowing events', note: 'Separates litter size from the number of farrowings.' },
    pigs_weaned_per_sow_per_year: { label: 'Pigs weaned per sow per year', formula: '(Weaned heads ÷ active sows) × (365 ÷ period days)', note: 'Annualized management KPI; not a replacement for a full parity cohort report.' },
    mortality_rate: { label: 'Mortality rate', formula: 'Mortality heads ÷ born heads, or configured fallback population', note: 'A warning is shown when the denominator is a fallback.' },
    feed_cost_per_allocated_kg: { label: 'Feed cost per allocated kg', formula: 'Allocated feed COGS ÷ allocated kilograms', note: 'Uses weighted-average purchase cost from dated feed deliveries.' },
    fcr: { label: 'Feed conversion ratio (FCR)', formula: 'Feed consumed kg ÷ total weight gain kg', note: 'Requires measured start/current weight and actual feed consumed.' },
    adg_kg_per_day: { label: 'Average daily gain (ADG)', formula: 'Weight gain kg ÷ days on test', note: 'Uses measured weights and dated weigh-in interval.' },
    feed_cost_efficiency: { label: 'Feed cost efficiency', formula: 'Feed cost ÷ total weight gain kg', note: 'Shown in PHP per kg gain; it is not the same as FCR.' },
    population_reconciliation: { label: 'Population reconciliation', formula: 'Starting + entries − mortality − transfers − sales = ending', note: 'A verified starting snapshot is required for an independent variance check.' }
  };

  const TRACKED_LEGACY_KEYS = [
    'sows', 'piglets', 'pigletLedger', 'treatments', 'vaccinations',
    'vaccination_events', 'vaxSchedules', 'movements', 'heatRecords',
    'breedingRecords', 'feedOrders', 'transactions', 'sales', 'semen',
    'semenSales', 'semenResellerTx', 'semenResellerAdjustments', 'med_movements', 'populationSnapshots',
    'benchmarkProfiles'
  ];

  const EVENT_LEGACY_KEYS = new Set(TRACKED_LEGACY_KEYS);
  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const clone = value => {
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const iso = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  };
  const now = () => new Date().toISOString();
  const safeText = value => String(value ?? '').trim();
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const farm = () => (typeof F === 'function' ? F() : null);
  const activeFarmId = () => String(window.__arsActiveFarmId || window.farmId || window.farmId || '');
  const currentActor = () => ({
    user_id: window.arsSessionUser?.id || null,
    email: String(window.arsSessionUser?.email || '').toLowerCase() || null,
    device_id: window.STORE?.getItem('ars-device-id') || null
  });

  function stableKey(item, type, index = 0) {
    if (!item || typeof item !== 'object') return `${type}-${index}`;
    return String(item.id || item.event_id || item._ars_cloud_local_id || item.no || item.tag || item.code || item.name || `${type}-${index}`);
  }

  function payloadSignature(value) {
    const copy = clone(value) || {};
    if (copy && typeof copy === 'object') {
      delete copy.updated_at;
      delete copy._ars_cloud_local_id;
    }
    return JSON.stringify(copy);
  }

  function shortRecord(value) {
    if (!value || typeof value !== 'object') return value;
    const allowed = [
      'id', 'event_id', 'type', 'event_type', 'date', 'event_date', 'created_at',
      'updated_at', 'name', 'title', 'description', 'category', 'status', 'cause',
      'quantity', 'unit', 'amount', 'paid', 'qty', 'product', 'batch_id', 'sow_id',
      'sow_name', 'subject_id', 'feed_type', 'bags', 'price', 'role', 'source'
    ];
    const result = {};
    allowed.forEach(key => { if (value[key] !== undefined) result[key] = clone(value[key]); });
    return result;
  }

  function changedFields(before, after) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...keys].filter(key => !['_ars_cloud_local_id', 'updated_at'].includes(key) && payloadSignature(before?.[key]) !== payloadSignature(after?.[key]));
  }

  function ensureArrays(f) {
    if (!f) return;
    ['productionEvents', 'feedAllocations', 'auditLog', 'integrationEvents'].forEach(key => {
      if (!Array.isArray(f[key])) f[key] = [];
    });
  }

  function actorFields() {
    const actor = currentActor();
    return {
      recorded_by: actor.user_id,
      recorded_by_email: actor.email,
      device_id: actor.device_id,
      app_version: APP_VERSION
    };
  }

  function eventLabel(type) { return EVENT_TYPES[type] || type || 'Event'; }

  function legacyEvent(key, item, index, options = {}) {
    if (!item || typeof item !== 'object') return null;
    const recordId = stableKey(item, key, index);
    let eventType = '';
    let quantity = num(item.quantity || item.heads || item.qty);
    let unit = item.unit || (quantity ? 'head' : undefined);
    let subjectType = item.subject_type || '';
    let subjectId = item.subject_id || '';
    let batchId = item.batch_id || item.batchId || '';
    let eventDate = iso(item.event_date || item.date || item.created_at || item.at || item.collection || item.insemination || item.birth);

    if (key === 'pigletLedger') {
      const mapping = {
        mortality: 'mortality', sold: 'sale', breeder: 'transfer_out', fattener: 'transfer_out',
        farm_use: 'transfer_out', reserved: 'transfer_out', foster_return_out: 'foster_out',
        foster_return_in: 'foster_in', cancel_reservation: 'event_voided'
      };
      eventType = mapping[item.type] || 'custom';
      subjectType = 'piglet_batch';
      subjectId = item.batch_id || '';
      eventDate = iso(item.event_date || item.date || item.created_at);
    } else if (key === 'piglets') {
      // A legacy piglet batch represents a farrowing/litter event. Keeping it
      // as one farrowing event avoids counting the same born heads twice.
      eventType = 'farrowing';
      subjectType = 'piglet_batch';
      subjectId = item.id || recordId;
      batchId = item.id || batchId;
      quantity = num(item.males) + num(item.females);
      unit = 'head';
      eventDate = iso(item.birth || item.birth_date || item.created_at);
    } else if (key === 'sows') {
      if (item.insemination) {
        eventType = 'service';
        subjectType = 'sow';
        subjectId = item.id || recordId;
        eventDate = iso(item.insemination);
        quantity = 1;
        unit = 'service';
      }
    } else if (key === 'treatments') {
      eventType = 'treatment';
      subjectType = item.subject_type || 'animal';
      subjectId = item.subject_id || item.sow_id || item.animal_id || '';
      eventDate = iso(item.date || item.treatment_date || item.created_at);
    } else if (key === 'vaccinations' || key === 'vaccination_events') {
      eventType = 'vaccination';
      subjectType = item.subject_type || item.target_type || 'animal';
      subjectId = item.subject_id || item.target_id || item.sow_id || item.batch_id || '';
      batchId = item.batch_id || '';
      eventDate = iso(item.date || item.event_date || item.created_at);
    } else if (key === 'movements') {
      eventType = item.direction === 'in' ? 'transfer_in' : (item.direction === 'out' ? 'transfer_out' : 'movement');
      subjectType = item.subject_type || 'animal_group';
      subjectId = item.subject_id || item.batch_id || '';
      batchId = item.batch_id || '';
      eventDate = iso(item.date || item.movement_date || item.created_at);
    } else if (key === 'heatRecords') {
      eventType = 'pregnancy_check';
      subjectType = 'sow';
      subjectId = item.sow_id || item.subject_id || '';
      eventDate = iso(item.date || item.heat_date || item.created_at);
      quantity = 1;
      unit = 'check';
    } else if (key === 'breedingRecords') {
      eventType = 'service';
      subjectType = 'sow';
      subjectId = item.sow_id || item.subject_id || '';
      eventDate = iso(item.date || item.service_date || item.created_at);
      quantity = 1;
      unit = 'service';
    } else if (key === 'feedOrders') {
      eventType = 'feed_order';
      subjectType = 'feed_inventory';
      subjectId = item.feed_type || item.id || recordId;
      eventDate = iso(item.order_date || item.date || item.created_at);
      quantity = num(item.bags);
      unit = 'bag';
    } else if (key === 'transactions') {
      eventType = 'financial_transaction';
      subjectType = 'financial';
      subjectId = item.id || recordId;
      eventDate = iso(item.date || item.created_at);
      quantity = num(item.amount);
      unit = 'PHP';
    } else if (key === 'sales') {
      eventType = 'sale';
      subjectType = 'sale';
      subjectId = item.id || recordId;
      eventDate = iso(item.date || item.created_at);
      quantity = num(item.qty || item.quantity);
      unit = item.unit || 'head';
    } else if (key === 'semen') {
      eventType = item.collection || item.collection_date ? 'semen_collection' : 'inventory_adjustment';
      subjectType = 'boar';
      subjectId = item.boar_id || item.boar || recordId;
      eventDate = iso(item.collection || item.collection_date || item.created_at);
      quantity = num(item.bottles || item.available_bottles);
      unit = 'bottle';
    } else if (key === 'semenSales' || key === 'semenResellerTx') {
      eventType = 'semen_use';
      subjectType = 'semen';
      subjectId = item.id || recordId;
      eventDate = iso(item.date || item.created_at);
      quantity = num(item.bottles || item.qty || item.quantity);
      unit = 'bottle';
    }

    if (!eventType || (!eventDate && options.requireDate !== false)) return null;
    return canonicalEvent({
      id: `pe-legacy-${key}-${recordId}`,
      idempotency_key: `legacy:${key}:${recordId}:${eventType}`,
      event_type: eventType,
      event_date: eventDate || today(),
      subject_type: subjectType,
      subject_id: subjectId,
      batch_id: batchId,
      quantity,
      unit,
      feed_type: item.feed_type || item.type,
      amount: num(item.amount || item.total_loss || (eventType === 'financial_transaction' ? item.amount : 0)),
      cause: item.cause || item.reason || '',
      source: options.source || 'legacy_derived',
      source_record_id: recordId,
      details: shortRecord(item)
    }, { allowLegacyId: true, allowCustom: true });
  }

  function canonicalEvent(input, options = {}) {
    const source = safeText(input?.source || 'manual') || 'manual';
    const eventType = safeText(input?.event_type || input?.type || 'custom').toLowerCase();
    const eventDate = iso(input?.event_date || input?.date) || (options.allowMissingDate ? today() : '');
    if (!eventDate) throw new Error('A valid event date is required.');
    if (!EVENT_TYPES[eventType] && !options.allowCustom) throw new Error(`Unsupported production event type: ${eventType}`);
    const actor = actorFields();
    const eventId = safeText(input?.id || input?.event_id) || id('pe');
    const idempotency = safeText(input?.idempotency_key) || `${source}:${eventType}:${eventId}`;
    const quantity = input?.quantity === '' || input?.quantity === null || input?.quantity === undefined ? null : num(input.quantity);
    if (quantity !== null && quantity < 0 && !['event_voided'].includes(eventType)) throw new Error('Event quantity cannot be negative. Use a direction or a compensating event.');
    return {
      id: eventId,
      event_id: eventId,
      farm_id: activeFarmId(),
      event_type: eventType,
      event_label: eventLabel(eventType),
      event_date: eventDate,
      subject_type: safeText(input?.subject_type),
      subject_id: safeText(input?.subject_id),
      batch_id: safeText(input?.batch_id),
      animal_id: safeText(input?.animal_id),
      from_location: safeText(input?.from_location),
      to_location: safeText(input?.to_location),
      feed_type: safeText(input?.feed_type),
      quantity,
      unit: safeText(input?.unit),
      male_quantity: input?.male_quantity === undefined ? null : num(input.male_quantity),
      female_quantity: input?.female_quantity === undefined ? null : num(input.female_quantity),
      amount: input?.amount === undefined ? null : num(input.amount),
      currency: safeText(input?.currency || 'PHP'),
      cause: safeText(input?.cause),
      source,
      source_record_id: safeText(input?.source_record_id),
      idempotency_key: idempotency,
      details: clone(input?.details || {}),
      status: 'active',
      created_at: input?.created_at || now(),
      updated_at: input?.updated_at || now(),
      ...actor
    };
  }

  function hasIdempotency(f, key) {
    return (f.productionEvents || []).some(event => event && event.idempotency_key === key);
  }

  function audit(f, action, entityType, entityId, before, after, extra = {}) {
    const actor = actorFields();
    const fields = changedFields(before || {}, after || {});
    const record = {
      id: id('audit'),
      audit_id: id('audit-ref'),
      farm_id: activeFarmId(),
      action,
      entity_type: entityType,
      entity_id: String(entityId || ''),
      record_label: safeText(after?.name || after?.description || after?.title || before?.name || before?.description || entityId),
      changed_fields: fields,
      before: shortRecord(before),
      after: shortRecord(after),
      source: extra.source || 'application',
      reason: extra.reason || '',
      occurred_at: now(),
      ...actor
    };
    f.auditLog.unshift(record);
    return record;
  }

  function appendEventToFarm(f, input, options = {}) {
    ensureArrays(f);
    const event = input.event_type && input.event_label ? input : canonicalEvent(input, options);
    if (hasIdempotency(f, event.idempotency_key)) {
      return { event: (f.productionEvents || []).find(x => x.idempotency_key === event.idempotency_key), duplicate: true };
    }
    f.productionEvents.unshift(event);
    if (options.audit !== false) audit(f, 'event_append', 'production_event', event.id, null, event, { source: event.source });
    return { event, duplicate: false };
  }

  function recordProductionEvent(input, options = {}) {
    const f = farm();
    if (!f) throw new Error('No active farm workspace.');
    const result = appendEventToFarm(f, input, options);
    if (options.save !== false && !result.duplicate && typeof window.save === 'function') window.save();
    return result.event;
  }

  function voidProductionEvent(eventId, reason) {
    const f = farm();
    const target = (f?.productionEvents || []).find(x => x.id === eventId || x.event_id === eventId);
    if (!target) throw new Error('Canonical event was not found.');
    if (!safeText(reason)) throw new Error('A void reason is required for auditability.');
    const event = recordProductionEvent({
      event_type: 'event_voided',
      event_date: today(),
      subject_type: target.subject_type,
      subject_id: target.subject_id,
      source: 'manual_void',
      source_record_id: target.id,
      idempotency_key: `void:${target.id}:${safeText(reason)}`,
      details: { reverses_event_id: target.id, reason: safeText(reason) }
    }, { save: false });
    audit(f, 'void', 'production_event', target.id, target, { status: 'voided', voided_by_event_id: event.id }, { reason: safeText(reason), source: 'manual_void' });
    window.save?.();
    return event;
  }

  function activeEvents(f) {
    ensureArrays(f);
    const voided = new Set((f.productionEvents || [])
      .filter(event => event.event_type === 'event_voided')
      .map(event => event.details?.reverses_event_id || event.source_record_id)
      .filter(Boolean));
    return (f.productionEvents || []).filter(event => event && event.event_type !== 'event_voided' && !voided.has(event.id));
  }

  function derivedLegacyEvents(f) {
    const result = [];
    EVENT_LEGACY_KEYS.forEach(key => {
      (f?.[key] || []).forEach((item, index) => {
        if (['undone', 'deleted', 'voided'].includes(String(item?.status || '').toLowerCase())) return;
        const event = legacyEvent(key, item, index);
        if (event) result.push(event);
        if (key === 'piglets' && (item.weanedAt || item.weaning_date || item.weaning || item.status === 'Weaned')) {
          const weanedDate = iso(item.weanedAt || item.weaning_date || item.weaning_date_recorded || item.created_at);
          if (weanedDate) {
            result.push(canonicalEvent({
              id: `pe-legacy-weaning-${item.id || index}`,
              idempotency_key: `legacy:weaning:${item.id || index}`,
              event_type: 'weaning',
              event_date: weanedDate,
              subject_type: 'piglet_batch',
              subject_id: item.id || '',
              batch_id: item.id || '',
              quantity: num(item.weaned_heads || item.weaned_count || num(item.males) + num(item.females)),
              unit: 'head',
              source: 'legacy_derived',
              source_record_id: item.id || `${key}-${index}`,
              details: { batch_id: item.id || '', status: item.status || '' }
            }, { allowLegacyId: true }));
          }
        }
        if (key === 'feedOrders' && Array.isArray(item.deliveries)) {
          item.deliveries.forEach((delivery, deliveryIndex) => {
            const deliveryEvent = canonicalEvent({
              id: `pe-legacy-feed-delivery-${item.id || index}-${delivery.id || deliveryIndex}`,
              idempotency_key: `legacy:feed_delivery:${item.id || index}:${delivery.id || deliveryIndex}`,
              event_type: 'feed_delivery',
              event_date: delivery.date || item.date || today(),
              subject_type: 'feed_inventory',
              subject_id: item.feed_type || item.id || '',
              feed_type: item.feed_type || '',
              quantity: num(delivery.bags),
              unit: 'bag',
              amount: num(delivery.amount),
              source: 'legacy_derived',
              source_record_id: delivery.id || `${item.id || index}-${deliveryIndex}`,
              details: { order_id: item.id || '', note: delivery.note || '' }
            }, { allowLegacyId: true });
            result.push(deliveryEvent);
          });
        }
      });
    });
    return result;
  }

  function allEvents(f) {
    const combined = [...activeEvents(f), ...derivedLegacyEvents(f)];
    const seen = new Set();
    return combined.filter(event => {
      const key = event.idempotency_key || event.id;
      const semantic = [event.event_type, event.event_date, event.subject_id || '', event.batch_id || '', event.quantity ?? ''].join('|');
      const lifecycleSemantic = ['farrowing', 'weaning'].includes(event.event_type)
        ? ['lifecycle', event.event_type, event.subject_id || '', event.batch_id || ''].join('|')
        : '';
      if (seen.has(key) || seen.has(`semantic:${semantic}`) || (lifecycleSemantic && seen.has(`semantic:${lifecycleSemantic}`))) return false;
      seen.add(key);
      seen.add(`semantic:${semantic}`);
      if (lifecycleSemantic) seen.add(`semantic:${lifecycleSemantic}`);
      return true;
    });
  }

  function feedBagKg(f, feedType) {
    const configured = f?.feedPlan?.bagKg || {};
    const found = Object.keys(configured).find(key => key.toLowerCase() === String(feedType || '').toLowerCase());
    if (found && num(configured[found]) > 0) return { kg: num(configured[found]), source: 'configured' };
    return { kg: String(feedType || '').toLowerCase() === 'pre starter' ? 25 : 50, source: 'application_default' };
  }

  function feedDeliveries(f, from, to) {
    const rows = [];
    const seen = new Set();
    allEvents(f).filter(event => event.event_type === 'feed_delivery').forEach(event => {
      const date = iso(event.event_date);
      if (date < from || date > to) return;
      const feedType = event.feed_type || event.subject_id;
      const bags = num(event.quantity);
      if (!feedType || bags <= 0) return;
      const bag = feedBagKg(f, feedType);
      const key = event.idempotency_key || event.id;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ id: key, date, feed_type: feedType, bags, kg: bags * bag.kg, amount: num(event.amount), bag_kg: bag.kg, bag_kg_source: bag.source, source: event.source, event });
    });
    return rows;
  }

  function feedAllocations(f, from, to) {
    return (f.feedAllocations || []).filter(row => row && row.status !== 'voided').map(row => {
      const date = iso(row.allocation_date || row.event_date || row.date);
      if (date < from || date > to) return null;
      const kg = num(row.quantity_kg || row.kg || row.quantity);
      return { ...row, date, quantity_kg: kg, feed_type: row.feed_type || row.type || 'Unspecified' };
    }).filter(Boolean);
  }

  function projectedFeed(f, daysAhead = 30) {
    if (typeof window.feedForecast !== 'function') return { kg: 0, byType: {}, source: 'unavailable' };
    try {
      const result = window.feedForecast(daysAhead);
      const byType = {};
      Object.entries(result?.totals || {}).forEach(([type, kg]) => { byType[type] = num(kg); });
      return { kg: Object.values(byType).reduce((sum, value) => sum + value, 0), byType, source: 'population_simulation' };
    } catch (_) {
      return { kg: 0, byType: {}, source: 'unavailable' };
    }
  }

  function computeFeedCosting(f, options = {}) {
    const from = iso(options.from) || (() => { const date = new Date(); date.setDate(date.getDate() - num(options.days, 30)); return date.toISOString().slice(0, 10); })();
    const to = iso(options.to) || today();
    const deliveries = feedDeliveries(f, from, to);
    const allocations = feedAllocations(f, from, to);
    const byType = {};
    const getType = type => byType[type] || (byType[type] = { feed_type: type, delivered_bags: 0, delivered_kg: 0, purchase_cost: 0, allocated_kg: 0, allocated_cost: 0, unallocated_kg: 0, avg_cost_per_kg: 0, warnings: [] });

    deliveries.forEach(row => {
      const target = getType(row.feed_type);
      target.delivered_bags += row.bags;
      target.delivered_kg += row.kg;
      target.purchase_cost += row.amount;
      target.bag_kg = row.bag_kg;
      target.bag_kg_source = row.bag_kg_source;
      if (!row.amount) target.warnings.push('Delivery has no recorded purchase amount.');
    });

    Object.entries(byType).forEach(([, row]) => {
      row.avg_cost_per_kg = row.delivered_kg > 0 ? row.purchase_cost / row.delivered_kg : 0;
    });

    allocations.forEach(row => {
      const target = getType(row.feed_type);
      const unitCost = num(row.unit_cost || row.cost_per_kg) || target.avg_cost_per_kg;
      target.allocated_kg += row.quantity_kg;
      target.allocated_cost += row.quantity_kg * unitCost;
      row.calculated_unit_cost = unitCost;
      row.calculated_cost = row.quantity_kg * unitCost;
      if (!unitCost) target.warnings.push('Allocation has no cost basis; record a feed delivery first.');
    });

    Object.values(byType).forEach(row => {
      row.unallocated_kg = Math.max(0, row.delivered_kg - row.allocated_kg);
      if (row.allocated_kg > row.delivered_kg && row.delivered_kg > 0) row.warnings.push('Allocated consumption exceeds recorded deliveries. Review dates or stock opening balance.');
    });

    const projected = projectedFeed(f, num(options.projected_days, 30));
    const warnings = [];
    if (!deliveries.length) warnings.push('No feed delivery events were found for this period.');
    if (!allocations.length) warnings.push('No actual feed allocations are recorded. Feed-costed COGS is not yet measurable.');
    if (Object.values(byType).some(row => row.warnings.length)) warnings.push('One or more feed types need cost-basis review.');

    return {
      from, to, deliveries, allocations, byType, projected,
      deliveredKg: deliveries.reduce((sum, row) => sum + row.kg, 0),
      purchaseCost: deliveries.reduce((sum, row) => sum + row.amount, 0),
      allocatedKg: allocations.reduce((sum, row) => sum + row.quantity_kg, 0),
      allocatedCost: allocations.reduce((sum, row) => sum + num(row.calculated_cost), 0),
      unallocatedKg: Object.values(byType).reduce((sum, row) => sum + row.unallocated_kg, 0),
      warnings
    };
  }

  function periodDates(daysBack) {
    const to = today();
    const date = new Date(`${to}T00:00:00`);
    date.setDate(date.getDate() - num(daysBack, 30) + 1);
    return { from: date.toISOString().slice(0, 10), to };
  }

  function eventInPeriod(event, from, to) {
    const date = iso(event.event_date);
    return date && date >= from && date <= to;
  }

  function activeLedgerRows(f) {
    return (f?.pigletLedger || []).filter(row => row && !['undone', 'deleted', 'voided'].includes(String(row.status || '').toLowerCase()));
  }

  function daySpan(from, to) {
    const a = iso(from), b = iso(to);
    if (!a || !b) return null;
    const start = new Date(`${a}T00:00:00`);
    const end = new Date(`${b}T00:00:00`);
    const days = Math.round((end - start) / 86400000);
    return Number.isFinite(days) ? days : null;
  }

  function batchLiveHeadcount(f, batch) {
    if (!batch) return 0;
    try {
      if (typeof window.getPigletCounts === 'function') {
        const counts = window.getPigletCounts(batch);
        if (counts && Number.isFinite(Number(counts.alive))) return Math.max(0, Number(counts.alive));
      }
    } catch (_) {}
    const original = num(batch.males) + num(batch.females);
    const removed = activeLedgerRows(f)
      .filter(row => row.batch_id === batch.id && ['mortality', 'sold'].includes(row.type))
      .reduce((sum, row) => sum + num(row.quantity), 0);
    return Math.max(0, original - removed);
  }

  function liveHeadcount(f, scope = 'piglet_batch') {
    if (scope === 'piglet_batch' || scope === 'piglets') {
      return (f?.piglets || []).filter(batch => !batch.archived).reduce((sum, batch) => sum + batchLiveHeadcount(f, batch), 0);
    }
    if (scope === 'sows') return (f?.sows || []).filter(sow => typeof isActiveSow !== 'function' || isActiveSow(sow)).length;
    if (scope === 'boars') return (f?.boars || []).filter(boar => String(boar.status || 'Active') === 'Active').length;
    return liveHeadcount(f, 'piglet_batch') + liveHeadcount(f, 'sows') + liveHeadcount(f, 'boars');
  }

  function populationEventMatches(event, scope) {
    if (scope === 'all') return true;
    if (scope === 'sows') return event.subject_type === 'sow';
    if (scope === 'boars') return event.subject_type === 'boar';
    return event.subject_type === 'piglet_batch' || Boolean(event.batch_id) || ['farrowing', 'weaning', 'mortality', 'foster_in', 'foster_out'].includes(event.event_type);
  }

  function computePopulationReconciliation(f, options = {}) {
    const periodDays = Math.max(1, num(options.days, 13 * 7));
    const windowDates = periodDates(periodDays);
    const from = iso(options.from) || windowDates.from;
    const to = iso(options.to) || windowDates.to;
    const scope = options.scope || 'piglet_batch';
    const events = allEvents(f).filter(event => populationEventMatches(event, scope));
    const periodEvents = events.filter(event => eventInPeriod(event, from, to));
    const sumTypes = types => periodEvents.filter(event => types.includes(event.event_type)).reduce((sum, event) => sum + Math.max(0, num(event.quantity)), 0);
    const entries = sumTypes(['birth', 'farrowing', 'transfer_in', 'foster_in']);
    const mortality = sumTypes(['mortality']);
    const transfers = sumTypes(['transfer_out', 'foster_out']);
    const sales = sumTypes(['sale']);
    const snapshots = (f.populationSnapshots || [])
      .filter(snapshot => snapshot && (snapshot.scope || 'piglet_batch') === scope && iso(snapshot.snapshot_date || snapshot.date) <= from)
      .sort((a, b) => String(b.snapshot_date || b.date).localeCompare(String(a.snapshot_date || a.date)));
    const startSnapshot = snapshots[0] || null;
    const endSnapshots = (f.populationSnapshots || [])
      .filter(snapshot => snapshot && (snapshot.scope || 'piglet_batch') === scope && iso(snapshot.snapshot_date || snapshot.date) <= to)
      .sort((a, b) => String(b.snapshot_date || b.date).localeCompare(String(a.snapshot_date || a.date)));
    const endSnapshot = endSnapshots[0] || null;
    const observedEnding = to >= today() ? liveHeadcount(f, scope) : (endSnapshot ? num(endSnapshot.headcount) : null);
    const netChange = entries - mortality - transfers - sales;
    const derivedStarting = observedEnding === null ? null : observedEnding - netChange;
    const starting = startSnapshot ? num(startSnapshot.headcount) : derivedStarting;
    const expectedEnding = startSnapshot ? starting + netChange : null;
    const variance = expectedEnding !== null && observedEnding !== null ? observedEnding - expectedEnding : null;
    return {
      from, to, scope, periodDays, entries, mortality, transfers, sales, netChange,
      starting, observedEnding, expectedEnding, variance, startSnapshot, endSnapshot,
      startingSource: startSnapshot ? 'verified_snapshot' : (derivedStarting === null ? 'unavailable' : 'derived_from_current_ending'),
      events: periodEvents
    };
  }

  function latestTrialForBatch(f, batchId) {
    return (f.feedTrials || []).filter(trial => trial && trial.batch_id === batchId)
      .sort((a, b) => String(b.as_of || b.started || b.created || '').localeCompare(String(a.as_of || a.started || a.created || '')))[0] || null;
  }

  function computeBatchGrowth(f, batch, options = {}) {
    if (!batch) return null;
    const trial = latestTrialForBatch(f, batch.id);
    const groups = trial?.groups || [];
    const firstGroup = groups.find(group => num(group.startW) !== null && num(group.curW) !== null) || groups[0] || {};
    const startWeight = num(batch.birth_weight) !== null ? num(batch.birth_weight) : (num(batch.weaning_weight) !== null ? num(batch.weaning_weight) : num(firstGroup.startW));
    const currentWeight = num(batch.release_weight) !== null ? num(batch.release_weight) : (num(batch.weaning_weight) !== null ? num(batch.weaning_weight) : num(firstGroup.curW));
    const startDate = batch.birth || trial?.started || '';
    const weightDate = batch.release_date || batch.weaning_date || batch.weanedAt || trial?.as_of || '';
    if (options.from && options.to && weightDate && (iso(weightDate) < iso(options.from) || iso(weightDate) > iso(options.to))) return null;
    const days = daySpan(startDate, weightDate || today());
    const heads = Math.max(1, num(firstGroup.heads) || batchLiveHeadcount(f, batch) || num(batch.males) + num(batch.females));
    const weightGainPerHead = startWeight !== null && currentWeight !== null ? currentWeight - startWeight : null;
    const totalGainKg = weightGainPerHead !== null ? weightGainPerHead * heads : null;
    const allCosting = computeFeedCosting(f, { from: '1970-01-01', to: '2999-12-31' });
    const allocations = (f.feedAllocations || []).filter(row => row && row.status !== 'voided' && (row.batch_id === batch.id || (row.target_type === 'piglet_batch' && row.target_id === batch.id)) && (!options.from || iso(row.allocation_date || row.date) >= iso(options.from)) && (!options.to || iso(row.allocation_date || row.date) <= iso(options.to)));
    let feedKg = allocations.reduce((sum, row) => sum + num(row.quantity_kg || row.kg || row.quantity), 0);
    let feedCost = allocations.reduce((sum, row) => {
      const type = row.feed_type || row.type;
      return sum + num(row.quantity_kg || row.kg || row.quantity) * num(allCosting.byType[type]?.avg_cost_per_kg || row.unit_cost || row.cost_per_kg);
    }, 0);
    let feedSource = allocations.length ? 'feed_allocation_ledger' : '';
    if (!allocations.length && groups.length) {
      feedKg = groups.reduce((sum, group) => sum + Math.max(0, num(group.feedKg || group.feed)), 0);
      feedCost = groups.reduce((sum, group) => sum + Math.max(0, num(group.feedKg || group.feed)) * Math.max(0, num(group.costKg || group.cost)), 0);
      feedSource = feedKg ? 'feed_trial' : '';
    }
    return {
      batch_id: batch.id,
      heads,
      start_weight_kg: startWeight,
      current_weight_kg: currentWeight,
      weight_gain_per_head_kg: weightGainPerHead,
      total_gain_kg: totalGainKg,
      days,
      adg_kg_per_day: totalGainKg !== null && days > 0 ? totalGainKg / heads / days : null,
      feed_kg: feedKg || null,
      feed_cost: feedCost || null,
      fcr: feedKg > 0 && totalGainKg > 0 ? feedKg / totalGainKg : null,
      feed_cost_efficiency: feedCost > 0 && totalGainKg > 0 ? feedCost / totalGainKg : null,
      feed_source: feedSource || 'unavailable',
      weight_source: startWeight !== null && currentWeight !== null ? (batch.release_weight !== undefined ? 'batch_performance' : 'feed_trial') : 'unavailable'
    };
  }

  function computeGrowthAggregate(f, options = {}) {
    const rows = (f.piglets || []).filter(batch => !batch.archived).map(batch => computeBatchGrowth(f, batch, options)).filter(row => row && (row.total_gain_kg !== null || row.feed_kg !== null));
    const totalGain = rows.reduce((sum, row) => sum + Math.max(0, num(row.total_gain_kg)), 0);
    const totalFeed = rows.reduce((sum, row) => sum + Math.max(0, num(row.feed_kg)), 0);
    const totalCost = rows.reduce((sum, row) => sum + Math.max(0, num(row.feed_cost)), 0);
    const headDays = rows.reduce((sum, row) => sum + Math.max(0, num(row.heads) * num(row.days)), 0);
    return {
      rows,
      total_gain_kg: totalGain,
      feed_kg: totalFeed,
      feed_cost: totalCost,
      adg_kg_per_day: headDays > 0 ? totalGain / headDays : null,
      fcr: totalGain > 0 && totalFeed > 0 ? totalFeed / totalGain : null,
      feed_cost_efficiency: totalGain > 0 && totalCost > 0 ? totalCost / totalGain : null
    };
  }

  function cohortKey(date, mode = 'quarter') {
    const raw = iso(date);
    if (!raw) return 'Undated';
    const [year, month] = raw.slice(0, 7).split('-').map(Number);
    if (mode === 'month') return raw.slice(0, 7);
    return `${year}-Q${Math.ceil(month / 3)}`;
  }

  function computeCohortReport(f, options = {}) {
    const mode = options.mode || 'quarter';
    const from = iso(options.from) || '1970-01-01';
    const to = iso(options.to) || today();
    const events = allEvents(f);
    const map = new Map();
    (f.piglets || []).filter(batch => batch && !batch.archived && iso(batch.birth) >= from && iso(batch.birth) <= to).forEach(batch => {
      const key = cohortKey(batch.birth, mode);
      if (!map.has(key)) map.set(key, { cohort: key, batches: [], born: 0, mortality: 0, weaned: 0, sold: 0, growth: [] });
      const row = map.get(key);
      row.batches.push(batch);
      row.born += num(batch.males) + num(batch.females);
      const batchEvents = events.filter(event => event.batch_id === batch.id || event.subject_id === batch.id);
      row.mortality += batchEvents.filter(event => event.event_type === 'mortality').reduce((sum, event) => sum + num(event.quantity), 0);
      row.weaned += batchEvents.filter(event => event.event_type === 'weaning').reduce((sum, event) => sum + num(event.quantity), 0);
      row.sold += batchEvents.filter(event => event.event_type === 'sale').reduce((sum, event) => sum + num(event.quantity), 0);
      const growth = computeBatchGrowth(f, batch);
      if (growth) row.growth.push(growth);
    });
    return [...map.values()].map(row => {
      const gain = row.growth.reduce((sum, growth) => sum + num(growth.total_gain_kg), 0);
      const feed = row.growth.reduce((sum, growth) => sum + num(growth.feed_kg), 0);
      const cost = row.growth.reduce((sum, growth) => sum + num(growth.feed_cost), 0);
      const headDays = row.growth.reduce((sum, growth) => sum + num(growth.heads) * num(growth.days), 0);
      return { ...row, live: Math.max(0, row.born - row.mortality - row.sold), fcr: gain > 0 && feed > 0 ? feed / gain : null, adg: headDays > 0 ? gain / headDays : null, feed_cost_efficiency: gain > 0 && cost > 0 ? cost / gain : null, feed_kg: feed, feed_cost: cost, mortality_rate: row.born ? row.mortality / row.born : null };
    }).sort((a, b) => String(b.cohort).localeCompare(String(a.cohort)));
  }

  function relatedBatchesForSow(f, sow) {
    return (f.piglets || []).filter(batch => batch && (
      batch.sow_id === sow.id || batch.dam_id === sow.id || batch.sow === sow.name || batch.dam === sow.name || batch.dam_name === sow.name
    ));
  }

  function computeParityReport(f, options = {}) {
    const from = iso(options.from) || '1970-01-01';
    const to = iso(options.to) || today();
    const events = allEvents(f);
    const groups = new Map();
    (f.sows || []).filter(sow => typeof isActiveSow !== 'function' || isActiveSow(sow)).forEach(sow => {
      const parity = Number.isFinite(Number(sow.parity)) ? Number(sow.parity) : 0;
      const key = String(parity);
      if (!groups.has(key)) groups.set(key, { parity, sows: 0, services: 0, farrowings: 0, born: 0, weaned: 0, mortality: 0 });
      const row = groups.get(key);
      row.sows++;
      const ids = new Set([sow.id, sow.name].filter(Boolean));
      const batches = relatedBatchesForSow(f, sow);
      batches.forEach(batch => ids.add(batch.id));
      const related = events.filter(event => ids.has(event.subject_id) || ids.has(event.batch_id)).filter(event => eventInPeriod(event, from, to));
      row.services += related.filter(event => event.event_type === 'service').length;
      row.farrowings += related.filter(event => event.event_type === 'farrowing').length;
      row.born += related.filter(event => event.event_type === 'farrowing' || event.event_type === 'birth').reduce((sum, event) => sum + num(event.quantity), 0) || batches.reduce((sum, batch) => sum + num(batch.males) + num(batch.females), 0);
      row.weaned += related.filter(event => event.event_type === 'weaning').reduce((sum, event) => sum + num(event.quantity), 0);
      row.mortality += related.filter(event => event.event_type === 'mortality').reduce((sum, event) => sum + num(event.quantity), 0);
    });
    return [...groups.values()].map(row => ({
      ...row,
      farrowing_rate: row.services ? row.farrowings / row.services : null,
      born_per_farrowing: row.farrowings ? row.born / row.farrowings : null,
      weaning_rate: row.born ? row.weaned / row.born : null,
      mortality_rate: row.born ? row.mortality / row.born : null
    })).sort((a, b) => a.parity - b.parity);
  }

  function periodRange(weeksBack, offsetWeeks = 0) {
    const end = new Date(`${today()}T00:00:00`);
    end.setDate(end.getDate() - offsetWeeks * 7);
    const to = end.toISOString().slice(0, 10);
    end.setDate(end.getDate() - weeksBack * 7 + 1);
    return { from: end.toISOString().slice(0, 10), to };
  }

  function compareValue(current, previous) {
    const c = current === null || current === undefined ? null : num(current);
    const p = previous === null || previous === undefined ? null : num(previous);
    return { current: c, previous: p, change: c !== null && p !== null && p !== 0 ? (c - p) / Math.abs(p) : null };
  }

  function computePeriodComparison(f) {
    const ranges = {
      current13: periodRange(13, 0), previous13: periodRange(13, 13),
      current52: periodRange(52, 0), previous52: periodRange(52, 52)
    };
    const report = {};
    Object.entries(ranges).forEach(([key, range]) => {
      const kpi = computeKpis(f, { from: range.from, to: range.to, days: daySpan(range.from, range.to) + 1 });
      const growth = computeGrowthAggregate(f, range);
      report[key] = { ...range, kpi, growth };
    });
    const fields = [
      ['farrowing_rate', 'Farrowing rate', 'rate'],
      ['preweaning_mortality_rate', 'Pre-weaning mortality', 'rate'],
      ['average_born_per_farrowing', 'Average born / farrowing', 'number'],
      ['weaning_rate', 'Weaning rate', 'rate'],
      ['fcr', 'Feed conversion ratio', 'number'],
      ['adg_kg_per_day', 'Average daily gain', 'kg'],
      ['feed_cost_efficiency', 'Feed cost / kg gain', 'money']
    ];
    const rows = fields.map(([key, label, unit]) => ({
      key, label, unit,
      current13: key === 'fcr' || key === 'adg_kg_per_day' || key === 'feed_cost_efficiency' ? report.current13.growth[key] : report.current13.kpi.kpis[key],
      previous13: key === 'fcr' || key === 'adg_kg_per_day' || key === 'feed_cost_efficiency' ? report.previous13.growth[key] : report.previous13.kpi.kpis[key],
      current52: key === 'fcr' || key === 'adg_kg_per_day' || key === 'feed_cost_efficiency' ? report.current52.growth[key] : report.current52.kpi.kpis[key],
      previous52: key === 'fcr' || key === 'adg_kg_per_day' || key === 'feed_cost_efficiency' ? report.previous52.growth[key] : report.previous52.kpi.kpis[key]
    })).map(row => ({ ...row, change13: compareValue(row.current13, row.previous13), change52: compareValue(row.current52, row.previous52) }));
    return { ranges, report, rows };
  }

  function findBenchmarkProfile(f, kpi, period = '52w', scope = 'industry') {
    return (f.benchmarkProfiles || []).find(profile => String(profile.kpi || profile.metric).toLowerCase() === String(kpi).toLowerCase() && String(profile.period || '52w').toLowerCase() === String(period).toLowerCase() && String(profile.scope || 'industry').toLowerCase() === String(scope).toLowerCase()) || null;
  }

  function percentileAgainstProfile(value, profile, lowerBetter = false) {
    if (value === null || value === undefined || !profile) return null;
    const points = [['p10', 0], ['p25', 25], ['p50', 50], ['p75', 75], ['p90', 90]].map(([key, score]) => [num(profile[key]), score]).filter(([point]) => Number.isFinite(point));
    if (points.length < 2) return null;
    points.sort((a, b) => a[0] - b[0]);
    let score;
    if (value <= points[0][0]) score = points[0][1];
    else if (value >= points[points.length - 1][0]) score = points[points.length - 1][1] + 10;
    else {
      for (let i = 1; i < points.length; i++) {
        if (value <= points[i][0]) {
          const [x0, y0] = points[i - 1], [x1, y1] = points[i];
          score = y0 + ((value - x0) / (x1 - x0 || 1)) * (y1 - y0);
          break;
        }
      }
    }
    score = Math.max(0, Math.min(100, score));
    return lowerBetter ? 100 - score : score;
  }

  function computeProductionIndex(f, options = {}) {
    const period = options.period || '52w';
    const daysBack = period === '13w' ? 91 : 364;
    const kpiReport = computeKpis(f, { days: daysBack });
    const growth = computeGrowthAggregate(f, { from: kpiReport.from, to: kpiReport.to });
    const metrics = {
      farrowing_rate: kpiReport.kpis.farrowing_rate,
      pigs_weaned_per_sow_per_year: kpiReport.kpis.pigs_weaned_per_sow_per_year,
      preweaning_mortality_rate: kpiReport.kpis.preweaning_mortality_rate,
      adg_kg_per_day: growth.adg_kg_per_day,
      fcr: growth.fcr,
      feed_cost_efficiency: growth.feed_cost_efficiency
    };
    const weights = {
      farrowing_rate: 0.20,
      pigs_weaned_per_sow_per_year: 0.25,
      preweaning_mortality_rate: 0.15,
      adg_kg_per_day: 0.15,
      fcr: 0.15,
      feed_cost_efficiency: 0.10
    };
    const lowerBetter = new Set(['preweaning_mortality_rate', 'fcr', 'feed_cost_efficiency']);
    const scored = Object.keys(weights).map(kpi => {
      const profile = findBenchmarkProfile(f, kpi, period, 'industry');
      const percentile = percentileAgainstProfile(metrics[kpi], profile, lowerBetter.has(kpi));
      return { kpi, value: metrics[kpi], weight: weights[kpi], profile, percentile };
    });
    const available = scored.filter(row => row.percentile !== null);
    const weightTotal = available.reduce((sum, row) => sum + row.weight, 0);
    const score = weightTotal ? available.reduce((sum, row) => sum + row.percentile * row.weight, 0) / weightTotal : null;
    return { period, from: kpiReport.from, to: kpiReport.to, metrics, scored, score, coverage: available.length / scored.length, benchmarkLoaded: (f.benchmarkProfiles || []).length > 0 };
  }

  function rankWithin(values, value, lowerBetter = false) {
    const valid = values.filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
    if (!valid.length || value === null || value === undefined) return null;
    const below = valid.filter(v => v <= Number(value)).length;
    const pct = valid.length <= 1 ? 100 : ((below - 1) / (valid.length - 1)) * 100;
    return lowerBetter ? 100 - pct : pct;
  }

  function computeSowLifetimeLeague(f) {
    const events = allEvents(f);
    const rows = (f.sows || []).map(sow => {
      const batches = relatedBatchesForSow(f, sow);
      const ids = new Set([sow.id, sow.name, ...batches.map(batch => batch.id)].filter(Boolean));
      const related = events.filter(event => ids.has(event.subject_id) || ids.has(event.batch_id));
      const farrowings = related.filter(event => event.event_type === 'farrowing');
      const services = related.filter(event => event.event_type === 'service');
      const born = farrowings.reduce((sum, event) => sum + num(event.quantity), 0) || batches.reduce((sum, batch) => sum + num(batch.males) + num(batch.females), 0);
      const weaned = related.filter(event => event.event_type === 'weaning').reduce((sum, event) => sum + num(event.quantity), 0);
      const mortality = related.filter(event => event.event_type === 'mortality').reduce((sum, event) => sum + num(event.quantity), 0);
      const firstDate = sow.dob || related.map(event => event.event_date).sort()[0] || today();
      const lifetimeDays = Math.max(1, daySpan(firstDate, today()) || 1);
      return {
        sow_id: sow.id,
        name: sow.name || sow.id,
        breed: sow.breed || sow.customBreed || '',
        parity: num(sow.parity) || 0,
        status: typeof status === 'function' ? status(sow) : (sow.status || ''),
        services: services.length,
        farrowings: farrowings.length,
        born,
        weaned,
        mortality,
        born_per_litter: farrowings.length ? born / farrowings.length : null,
        weaned_per_litter: farrowings.length ? weaned / farrowings.length : null,
        mortality_rate: born ? mortality / born : null,
        weaned_per_sow_year: weaned * 365 / lifetimeDays
      };
    });
    const scores = {
      born_per_litter: rows.map(row => row.born_per_litter),
      weaned_per_litter: rows.map(row => row.weaned_per_litter),
      weaned_per_sow_year: rows.map(row => row.weaned_per_sow_year),
      mortality_rate: rows.map(row => row.mortality_rate)
    };
    rows.forEach(row => {
      const components = [
        rankWithin(scores.born_per_litter, row.born_per_litter),
        rankWithin(scores.weaned_per_litter, row.weaned_per_litter),
        rankWithin(scores.weaned_per_sow_year, row.weaned_per_sow_year),
        rankWithin(scores.mortality_rate, row.mortality_rate, true)
      ].filter(value => value !== null);
      row.internal_score = components.length ? components.reduce((sum, value) => sum + value, 0) / components.length : null;
    });
    rows.sort((a, b) => (b.internal_score ?? -1) - (a.internal_score ?? -1));
    rows.forEach((row, index) => { row.rank = index + 1; });
    return rows;
  }

  function computeKpis(f, options = {}) {
    const periodDays = Math.max(1, num(options.days, 30));
    const dates = { from: iso(options.from) || periodDates(periodDays).from, to: iso(options.to) || periodDates(periodDays).to };
    const events = allEvents(f).filter(event => eventInPeriod(event, dates.from, dates.to));
    const count = type => events.filter(event => event.event_type === type).length;
    const quantity = type => events.filter(event => event.event_type === type).reduce((sum, event) => sum + Math.max(0, num(event.quantity)), 0);
    const activeSows = (f.sows || []).filter(sow => typeof isActiveSow !== 'function' || isActiveSow(sow)).length;
    const activeBatches = (f.piglets || []).filter(batch => !batch.archived).length;
    const born = quantity('birth') + quantity('farrowing');
    const mortalityEvents = events.filter(event => event.event_type === 'mortality');
    const mortality = mortalityEvents.reduce((sum, event) => sum + Math.max(0, num(event.quantity)), 0);
    const weaned = quantity('weaning');
    const sold = quantity('sale');
    const services = count('service');
    const farrowings = count('farrowing');
    const weaningDates = new Map(events.filter(event => event.event_type === 'weaning' && (event.batch_id || event.subject_id)).map(event => [event.batch_id || event.subject_id, iso(event.event_date)]));
    const preweaningMortality = mortalityEvents.filter(event => {
      const batchId = event.batch_id || event.subject_id;
      const weaningDate = weaningDates.get(batchId);
      return !weaningDate || iso(event.event_date) <= weaningDate;
    }).reduce((sum, event) => sum + Math.max(0, num(event.quantity)), 0);
    const feed = computeFeedCosting(f, { from: dates.from, to: dates.to, projected_days: 30 });
    const growth = computeGrowthAggregate(f, { from: dates.from, to: dates.to });
    const denominator = born || Math.max(1, activeBatches ? activeBatches * 10 : activeSows);
    const kpis = {
      active_sows: activeSows,
      active_batches: activeBatches,
      services,
      farrowings,
      born,
      weaned,
      sold,
      mortality,
      preweaning_mortality: preweaningMortality,
      mortality_rate: mortality / denominator,
      preweaning_mortality_rate: born ? preweaningMortality / born : null,
      farrowing_rate: services ? farrowings / services : null,
      average_born_per_farrowing: farrowings ? born / farrowings : null,
      weaning_rate: born ? weaned / born : null,
      pigs_weaned_per_sow_per_year: activeSows ? (weaned / activeSows) * (365 / periodDays) : null,
      feed_delivered_kg: feed.deliveredKg,
      feed_allocated_kg: feed.allocatedKg,
      feed_purchase_cost: feed.purchaseCost,
      feed_cogs: feed.allocatedCost,
      feed_unallocated_kg: feed.unallocatedKg,
      feed_cost_per_allocated_kg: feed.allocatedKg ? feed.allocatedCost / feed.allocatedKg : null,
      feed_projected_30d_kg: feed.projected.kg,
      weight_gain_kg: growth.total_gain_kg,
      adg_kg_per_day: growth.adg_kg_per_day,
      fcr: growth.fcr,
      feed_cost_efficiency: growth.feed_cost_efficiency
    };
    const quality = { missing_date: 0, missing_subject: 0, negative_quantity: 0, legacy_derived: 0, feed_warnings: feed.warnings.length, notes: [] };
    events.forEach(event => {
      if (!iso(event.event_date)) quality.missing_date++;
      if (!event.subject_id && !event.batch_id && !['financial_transaction', 'feed_delivery', 'feed_order'].includes(event.event_type)) quality.missing_subject++;
      if (num(event.quantity) < 0) quality.negative_quantity++;
      if (event.source === 'legacy_derived') quality.legacy_derived++;
    });
    if (quality.legacy_derived) quality.notes.push(`${quality.legacy_derived} KPI event(s) are derived from legacy records and should be confirmed as canonical events.`);
    if (quality.missing_subject) quality.notes.push(`${quality.missing_subject} event(s) lack a subject animal or batch link.`);
    if (quality.feed_warnings) quality.notes.push(...feed.warnings);
    return { from: dates.from, to: dates.to, periodDays, events, kpis, quality, feed, growth };
  }

  function appendFeedAllocation(input, options = {}) {
    const f = farm();
    if (!f) throw new Error('No active farm workspace.');
    ensureArrays(f);
    const feedType = safeText(input.feed_type || input.type);
    const quantityKg = num(input.quantity_kg || input.kg || input.quantity);
    const date = iso(input.allocation_date || input.event_date || input.date);
    if (!feedType) throw new Error('Select a feed type.');
    if (!date) throw new Error('A valid allocation date is required.');
    if (quantityKg <= 0) throw new Error('Feed quantity must be greater than zero.');
    const allocation = {
      id: safeText(input.id) || id('feedalloc'),
      allocation_date: date,
      feed_type: feedType,
      quantity_kg: quantityKg,
      target_type: safeText(input.target_type || 'group'),
      target_id: safeText(input.target_id || input.batch_id || ''),
      batch_id: safeText(input.batch_id),
      headcount: input.headcount === undefined ? null : num(input.headcount),
      source: safeText(input.source || 'manual'),
      note: safeText(input.note || input.notes),
      status: 'active',
      created_at: now(),
      ...actorFields()
    };
    if (f.feedAllocations.some(row => row.id === allocation.id)) throw new Error('This feed allocation ID already exists.');
    f.feedAllocations.unshift(allocation);
    appendEventToFarm(f, {
      event_type: 'feed_consumption',
      event_date: date,
      subject_type: allocation.target_type,
      subject_id: allocation.target_id,
      batch_id: allocation.batch_id,
      feed_type: feedType,
      quantity: quantityKg,
      unit: 'kg',
      source: allocation.source,
      source_record_id: allocation.id,
      idempotency_key: `feed-allocation:${allocation.id}`,
      details: { allocation_id: allocation.id, headcount: allocation.headcount, note: allocation.note }
    }, { save: false });
    audit(f, 'create', 'feed_allocation', allocation.id, null, allocation, { source: allocation.source });
    if (options.save !== false) window.save?.();
    return allocation;
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function eventCsv(f) {
    const headers = ['id', 'event_type', 'event_date', 'subject_type', 'subject_id', 'batch_id', 'feed_type', 'quantity', 'unit', 'amount', 'cause', 'source', 'source_record_id', 'idempotency_key', 'details_json'];
    const rows = [headers.join(',')];
    activeEvents(f).forEach(event => rows.push(headers.map(key => csvEscape(key === 'details_json' ? JSON.stringify(event.details || {}) : event[key])).join(',')));
    return rows.join('\n');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ',' && !quoted) { row.push(cell); cell = ''; continue; }
      if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        continue;
      }
      cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift().map(header => header.trim());
    return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }

  function importCsv(text, options = {}) {
    const f = farm();
    if (!f) throw new Error('No active farm workspace.');
    ensureArrays(f);
    const rows = parseCsv(text);
    if (!rows.length) throw new Error('The CSV file contains no event rows.');
    let imported = 0, skipped = 0;
    const batchId = options.batch_id || id('csv');
    rows.forEach((row, index) => {
      const eventType = safeText(row.event_type || row.type || 'custom').toLowerCase();
      const key = safeText(row.idempotency_key) || `csv:${batchId}:${index}`;
      if (hasIdempotency(f, key)) { skipped++; return; }
      let details = {};
      if (row.details_json) {
        try { details = JSON.parse(row.details_json); } catch (_) { details = { raw_details: row.details_json }; }
      }
      const event = canonicalEvent({
        id: safeText(row.id) || id('pe-import'),
        event_type: eventType,
        event_date: row.event_date || row.date,
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        batch_id: row.batch_id,
        feed_type: row.feed_type,
        quantity: row.quantity === '' ? null : num(row.quantity),
        unit: row.unit,
        amount: row.amount === '' ? null : num(row.amount),
        cause: row.cause,
        source: 'csv_import',
        source_record_id: row.source_record_id || `${batchId}:${index}`,
        idempotency_key: key,
        details: { ...details, import_batch_id: batchId, original_row: index + 2 }
      }, { allowCustom: true });
      appendEventToFarm(f, event, { audit: false });
      imported++;
    });
    const receipt = {
      id: id('integration'),
      integration_type: 'csv_event_import',
      batch_id: batchId,
      imported,
      skipped,
      received_at: now(),
      source: options.source || 'csv_upload',
      ...actorFields()
    };
    f.integrationEvents.unshift(receipt);
    audit(f, 'integration_import', 'integration_event', receipt.id, null, receipt, { source: 'csv_upload' });
    window.save?.();
    return { imported, skipped, batch_id: batchId };
  }

  function dataQualityReport(f) {
    const rows = [];
    const check = (label, key, fn) => {
      const records = Array.isArray(f?.[key]) ? f[key] : [];
      const bad = records.filter((item, index) => !fn(item, index));
      rows.push({ label, key, total: records.length, bad: bad.length });
    };
    check('Sows with stable ID and name', 'sows', item => safeText(item?.id) && safeText(item?.name));
    check('Piglet batches with birth date', 'piglets', item => safeText(item?.id) && iso(item?.birth));
    check('Feed rows with type, quantity and price', 'feed', item => safeText(item?.type) && num(item?.bags) >= 0 && num(item?.price) >= 0);
    check('Transactions with date, type and amount', 'transactions', item => iso(item?.date) && ['Income', 'Expense'].includes(item?.type) && num(item?.amount) >= 0);
    check('Treatments with date, subject, medicine and dose', 'treatments', item => iso(item?.date) && safeText(item?.animal_ref || item?.sow_id) && safeText(item?.medicine || item?.medicine_name) && num(item?.dosage_ml) > 0);
    check('Vaccinations with date, target, vaccine and dose', 'vaccinations', item => iso(item?.date) && safeText(item?.target_id || item?.sow_id || item?.batch_id) && safeText(item?.vaccine) && num(item?.dose_ml) > 0);
    check('Movements with date and source/destination', 'movements', item => iso(item?.date || item?.movement_date) && (safeText(item?.from_pen || item?.from_location) || safeText(item?.to_pen || item?.to_location)));
    check('Canonical events with date and type', 'productionEvents', item => iso(item?.event_date) && Boolean(EVENT_TYPES[item?.event_type] || item?.event_type));
    check('Feed allocations with date, type and kg', 'feedAllocations', item => iso(item?.allocation_date) && safeText(item?.feed_type) && num(item?.quantity_kg) > 0);
    check('Audit records with actor and source', 'auditLog', item => safeText(item?.occurred_at) && safeText(item?.source) && (safeText(item?.recorded_by_email) || safeText(item?.recorded_by)));
    return rows;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(num(value));
  }
  function formatNumber(value, digits = 1) { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-PH', { maximumFractionDigits: digits }); }
  function formatRate(value) { return value === null || value === undefined ? '—' : `${(num(value) * 100).toFixed(1)}%`; }

  function kpiCard(label, value, note, tone = '') {
    return `<div class="panel pc-kpi-card ${tone}"><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(note || '')}</span></div>`;
  }

  function productionIntelligenceHTML(f, report) {
    const growth = report.growth || computeGrowthAggregate(f);
    const reconciliation = computePopulationReconciliation(f, { days: 13 * 7, scope: 'piglet_batch' });
    const index = computeProductionIndex(f, { period: '52w' });
    const indexText = index.score === null ? '—' : `${index.score.toFixed(1)} / 100`;
    const indexNote = index.score === null ? 'Import verified industry benchmark percentiles first' : `${Math.round(index.coverage * 100)}% of weighted KPIs benchmarked`;
    const varianceText = reconciliation.variance === null ? 'Snapshot required' : `${reconciliation.variance > 0 ? '+' : ''}${formatNumber(reconciliation.variance, 0)} head`;
    return `<div class="panel pc-section pc-intelligence"><div class="pc-section-head"><div><h3>Production intelligence</h3><p class="muted">Population reconciliation, growth efficiency, benchmark scoring and historical production reports.</p></div><button type="button" class="btn ghost" onclick="window.openPopulationReconciliation()">＋ Headcount snapshot</button></div><div class="pc-intel-kpis">${kpiCard('Ending piglet headcount', formatNumber(reconciliation.observedEnding, 0), `13-week scope · ${reconciliation.startingSource.replace(/_/g, ' ')}`)}${kpiCard('Weight gain', growth.total_gain_kg == null ? '—' : `${Number(growth.total_gain_kg).toFixed(1)} kg`, growth.total_gain_kg == null ? 'Requires measured start/current weight' : 'measured gain across tracked batches')}${kpiCard('FCR', growth.fcr == null ? '—' : Number(growth.fcr).toFixed(2), growth.fcr == null ? 'Requires feed and measured weight gain' : 'kg feed ÷ kg weight gain')}${kpiCard('ADG', growth.adg_kg_per_day == null ? '—' : `${Number(growth.adg_kg_per_day).toFixed(3)} kg/day`, growth.adg_kg_per_day == null ? 'Requires dated weights' : 'weight gain ÷ days')}${kpiCard('Feed cost efficiency', growth.feed_cost_efficiency == null ? '—' : formatMoney(growth.feed_cost_efficiency), growth.feed_cost_efficiency == null ? 'Requires feed cost and weight gain' : 'PHP per kg gain')}${kpiCard('Production index', indexText, indexNote, index.score === null ? 'warn' : '')}</div><div class="pc-recon-line"><span><b>Starting</b> ${formatNumber(reconciliation.starting, 0)}</span><span>＋ <b>Entries</b> ${formatNumber(reconciliation.entries, 0)}</span><span>− <b>Mortality</b> ${formatNumber(reconciliation.mortality, 0)}</span><span>− <b>Transfers</b> ${formatNumber(reconciliation.transfers, 0)}</span><span>− <b>Sales</b> ${formatNumber(reconciliation.sales, 0)}</span><span>＝ <b>Expected ending</b> ${formatNumber(reconciliation.expectedEnding, 0)}</span><span class="${reconciliation.variance === null ? 'pc-recon-pending' : (reconciliation.variance === 0 ? 'pc-good' : 'pc-bad')}">Variance: ${varianceText}</span></div><div class="pc-report-actions"><button type="button" class="btn ghost" onclick="window.openCohortReport()">▦ Cohort report</button><button type="button" class="btn ghost" onclick="window.openParityBenchmark()">♙ Parity benchmarking</button><button type="button" class="btn ghost" onclick="window.openPeriodComparison()">↔ 13 / 52-week comparison</button><button type="button" class="btn ghost" onclick="window.openProductionIndex()">★ Production index</button><button type="button" class="btn ghost" onclick="window.openSowLifetimeLeague()">🏆 Sow lifetime league</button><button type="button" class="btn" onclick="window.openBenchmarkImport()">⇧ Import benchmarks</button></div>${index.score === null ? '<div class="pc-warning">Industry percentiles are intentionally not invented. Import a verified benchmark profile with p10, p25, p50, p75 and p90 values before publishing an industry score.</div>' : ''}</div>`;
  }

  function controlCenterHTML() {
    const f = farm() || {};
    const daysBack = Number(window.__arsKpiDays || 30);
    const report = computeKpis(f, { days: daysBack });
    const k = report.kpis;
    const q = report.quality;
    const feed = report.feed;
    const qualityTotal = q.missing_date + q.missing_subject + q.negative_quantity + q.feed_warnings;
    const qualityTone = qualityTotal ? 'warn' : 'ok';
    const qualityText = qualityTotal ? `${qualityTotal} review item${qualityTotal === 1 ? '' : 's'}` : 'No current warnings';
    const feedRows = Object.values(feed.byType).map(row => `<tr><td><b>${esc(row.feed_type)}</b></td><td>${formatNumber(row.delivered_kg)} kg</td><td>${formatNumber(row.allocated_kg)} kg</td><td>${formatMoney(row.allocated_cost)}</td><td>${formatNumber(row.unallocated_kg)} kg</td><td>${row.warnings.length ? '<span class="tag warn">Review</span>' : '<span class="tag">OK</span>'}</td></tr>`).join('');
    const qualityRows = dataQualityReport(f).map(row => `<tr><td>${esc(row.label)}</td><td>${row.total}</td><td class="${row.bad ? 'pc-bad' : 'pc-good'}">${row.bad}</td><td>${row.total ? formatRate(1 - row.bad / row.total) : '—'}</td></tr>`).join('');
    return `<section id="productionControlCenter" class="production-control-center">
      <div class="pc-header panel"><div><div class="eyebrow">PRODUCTION CONTROL CENTER · ${APP_VERSION}</div><h2>Standard events, KPIs, feed costing &amp; audit</h2><p class="muted">This layer preserves legacy records and makes new events measurable, traceable and exportable.</p></div><div class="pc-header-actions"><select class="select" onchange="window.setProductionKpiPeriod(this.value)"><option value="30" ${daysBack === 30 ? 'selected' : ''}>Last 30 days</option><option value="90" ${daysBack === 90 ? 'selected' : ''}>Last 90 days</option><option value="365" ${daysBack === 365 ? 'selected' : ''}>Last 12 months</option></select><button type="button" class="btn ghost" onclick="window.openKpiDefinitions()">ⓘ KPI definitions</button><button type="button" class="btn ghost" onclick="window.openProductionEventLedger()">▤ Event ledger</button><button type="button" class="btn ghost" onclick="window.openAuditLog()">🛡 Audit log</button><button type="button" class="btn" onclick="window.openIntegrationHub()">↔ Integrations</button><button type="button" class="btn" onclick="go('kpis')">📊 KPI Center</button></div></div>
      <div class="pc-notice ${qualityTone}"><b>Data quality: ${esc(qualityText)}</b><span>${q.legacy_derived ? `${q.legacy_derived} KPI events currently come from legacy records; new entries are recorded canonically.` : 'Canonical events are active for new records.'}</span><button type="button" class="btn ghost small" onclick="window.openDataQualityReport()">Review quality</button></div>
      <div class="pc-kpi-grid">
        ${kpiCard('Farrowing rate', formatRate(k.farrowing_rate), `${k.farrowings} farrowings / ${k.services} services`, k.farrowing_rate === null ? 'warn' : '')}
        ${kpiCard('Pre-weaning mortality', formatRate(k.preweaning_mortality_rate), `${formatNumber(k.preweaning_mortality, 0)} pre-weaning deaths / ${formatNumber(k.born, 0)} born`, k.preweaning_mortality_rate !== null && k.preweaning_mortality_rate > .1 ? 'warn' : '')}
        ${kpiCard('Average born / farrowing', formatNumber(k.average_born_per_farrowing), `${formatNumber(k.born, 0)} born across ${k.farrowings} farrowings`)}
        ${kpiCard('Pigs weaned / sow / year', formatNumber(k.pigs_weaned_per_sow_per_year), `${formatNumber(k.weaned, 0)} weaned · ${k.active_sows} active sows`)}
        ${kpiCard('Feed delivered', `${formatNumber(k.feed_delivered_kg)} kg`, `${formatMoney(k.feed_purchase_cost)} purchase cost`)}
        ${kpiCard('Feed allocated / COGS', `${formatNumber(k.feed_allocated_kg)} kg`, `${formatMoney(k.feed_cogs)} actual allocated cost`, k.feed_allocated_kg ? '' : 'warn')}
        ${kpiCard('Feed cost / kg', k.feed_cost_per_allocated_kg == null ? '—' : formatMoney(k.feed_cost_per_allocated_kg), k.feed_cost_per_allocated_kg == null ? 'Allocate actual consumption to measure' : 'weighted average cost basis')}
        ${kpiCard('Mortality rate', formatRate(k.mortality_rate), `${formatNumber(k.mortality, 0)} mortality events/heads`, k.mortality_rate > .1 ? 'warn' : '')}
      </div>
      <div class="pc-two-col">
        <div class="panel pc-section"><div class="pc-section-head"><div><h3>Feed cost allocation ledger</h3><p class="muted">Purchased feed is not treated as consumed COGS until allocated to a group or batch.</p></div><button type="button" class="btn" onclick="window.openFeedAllocationModal()">＋ Allocate feed usage</button></div><div class="pc-summary-strip"><span>Delivered <b>${formatNumber(feed.deliveredKg)} kg</b></span><span>Allocated <b>${formatNumber(feed.allocatedKg)} kg</b></span><span>Unallocated <b>${formatNumber(feed.unallocatedKg)} kg</b></span><span>Projected next 30d <b>${formatNumber(feed.projected.kg)} kg</b></span></div><div class="table-wrap"><table class="table pc-table"><thead><tr><th>Feed type</th><th>Delivered</th><th>Allocated</th><th>Allocated cost</th><th>Unallocated</th><th>Review</th></tr></thead><tbody>${feedRows || '<tr><td colspan="6" class="empty">No feed delivery/allocation events in this period.</td></tr>'}</tbody></table></div>${feed.warnings.map(w => `<div class="pc-warning">⚠ ${esc(w)}</div>`).join('')}</div>
        <div class="panel pc-section"><div class="pc-section-head"><div><h3>Audit and data-quality coverage</h3><p class="muted">Changes are recorded with actor, device, source, before/after summary and changed fields.</p></div><button type="button" class="btn ghost" onclick="window.openDataQualityReport()">Review</button></div><div class="pc-audit-counts"><div><b>${(f.auditLog || []).length}</b><small>audit records</small></div><div><b>${(f.productionEvents || []).length}</b><small>canonical events</small></div><div><b>${(f.integrationEvents || []).length}</b><small>integration receipts</small></div></div><div class="table-wrap"><table class="table pc-table"><thead><tr><th>Dataset</th><th>Total</th><th>Review</th><th>Quality</th></tr></thead><tbody>${qualityRows}</tbody></table></div></div>
      </div>
      ${productionIntelligenceHTML(f, report)}
    </section>`;
  }

  /* [REBUILD FIX 72] PERFORMANCE: the KPI aggregates (computeKpis ×5, growth,
     reconciliation, league, parity) are expensive on phones. They now render
     ONLY while their page is on screen, and recompute only when farm data
     actually changed (local save counter + last cloud sync stamp + period). */
  const __arsPcPrevSave = window.save;
  window.save = function () {
    window.__arsDataRev = (window.__arsDataRev || 0) + 1;
    if (typeof __arsPcPrevSave === 'function') return __arsPcPrevSave.apply(this, arguments);
  };
  const pcRevKey = extra => [window.__arsDataRev || 0, window.__arsLastSuccessfulSyncAt || '', window.__arsKpiDays || 30, extra].join('|');
  const pcMemo = { ctrlKey: null, ctrlHtml: '', ctrlWritten: null, kpiKey: null, kpiHtml: '', kpiWritten: null };

  function appendControlCenter() {
    const host = document.getElementById('production');
    if (!host || !host.classList.contains('active')) return;
    const key = pcRevKey('ctrl');
    if (pcMemo.ctrlKey !== key) {
      pcMemo.ctrlKey = key;
      pcMemo.ctrlHtml = controlCenterHTML();
    }
    if (pcMemo.ctrlWritten === pcMemo.ctrlHtml && host.querySelector('#productionControlCenter')) return;
    host.querySelector('#productionControlCenter')?.remove();
    host.insertAdjacentHTML('beforeend', pcMemo.ctrlHtml);
    pcMemo.ctrlWritten = pcMemo.ctrlHtml;
  }

  function setProductionKpiPeriod(daysBack) {
    window.__arsKpiDays = Number(daysBack) || 30;
    appendControlCenter();
    renderKpiCenter(); /* keep the dedicated KPI Center page in sync */
  }

  /* ═══ [REBUILD FEATURE] Dedicated KPI Center page (data-page="kpis") ═══
     Standalone home for the Production Control Center's intelligence:
     hero KPI grid, growth efficiency & reconciliation, 13/52-week trends,
     production index, sow lifetime league and parity benchmarking — all
     computed live from recorded production events. */
  function trendSpan(change, lowerBetter) {
    if (change === null || change === undefined || !Number.isFinite(Number(change))) return '<span class="muted">—</span>';
    const up = Number(change) >= 0;
    const flat = Math.abs(Number(change)) < 0.0005;
    const good = lowerBetter ? !up : up;
    const cls = flat ? 'muted' : (good ? 'pc-good' : 'pc-bad');
    return `<span class="${cls}">${up ? '▲' : '▼'} ${(Math.abs(Number(change)) * 100).toFixed(1)}%</span>`;
  }

  function fmtByUnit(value, unit) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    if (unit === 'rate') return formatRate(value);
    if (unit === 'money') return formatMoney(value);
    if (unit === 'kg') return `${Number(value).toFixed(3)} kg/d`;
    if (unit === 'number') return formatNumber(value, 2);
    return formatNumber(value, 2);
  }

  const LOWER_BETTER = new Set(['preweaning_mortality_rate', 'mortality_rate', 'fcr', 'feed_cost_efficiency']);

  function kpiCenterHTML(f) {
    const daysBack = Number(window.__arsKpiDays || 30);
    const report = computeKpis(f, { days: daysBack });
    const k = report.kpis;
    const growth = computeGrowthAggregate(f, { from: report.from, to: report.to });
    const reconciliation = computePopulationReconciliation(f);
    const index = computeProductionIndex(f);
    const comparison = computePeriodComparison(f);
    const league = computeSowLifetimeLeague(f);
    const parity = computeParityReport(f);
    const varianceText = reconciliation.variance === null ? 'snapshot pending' : String(reconciliation.variance);
    const periodSelect = `<select class="select" onchange="window.setProductionKpiPeriod(this.value)"><option value="30" ${daysBack === 30 ? 'selected' : ''}>Last 30 days</option><option value="90" ${daysBack === 90 ? 'selected' : ''}>Last 90 days</option><option value="365" ${daysBack === 365 ? 'selected' : ''}>Last 12 months</option></select>`;

    const cmpRows = comparison.rows.map(row => {
      const lb = LOWER_BETTER.has(row.key);
      return `<tr><td><b>${esc(row.label)}</b></td><td>${fmtByUnit(row.current13, row.unit)}</td><td class="muted">${fmtByUnit(row.previous13, row.unit)}</td><td>${trendSpan(row.change13 ? row.change13.change : null, lb)}</td><td>${fmtByUnit(row.current52, row.unit)}</td><td>${trendSpan(row.change52 ? row.change52.change : null, lb)}</td></tr>`;
    }).join('');

    const indexRows = index.scored.map(row => {
      const unit = row.kpi === 'feed_cost_efficiency' ? 'money' : row.kpi === 'adg_kg_per_day' ? 'kg' : row.kpi === 'fcr' ? 'number' : (row.kpi === 'pigs_weaned_per_sow_per_year' || row.kpi === 'average_born_per_farrowing') ? 'number' : 'rate';
      return `<tr><td><b>${esc(KPI_DEFINITIONS[row.kpi]?.label || row.kpi)}</b></td><td>${fmtByUnit(row.value, unit)}</td><td>${row.profile ? `${row.profile.p10 ?? '—'} / ${row.profile.p50 ?? '—'} / ${row.profile.p90 ?? '—'}` : '<span class="tag warn">No profile</span>'}</td><td>${row.percentile == null ? '—' : `${row.percentile.toFixed(0)}`}</td><td>${(row.weight * 100).toFixed(0)}%</td></tr>`;
    }).join('');

    const leagueRows = league.map(row => {
      const tone = row.internal_score == null ? '' : (row.rank <= 3 ? 'pc-good' : (league.length > 4 && row.rank > league.length - 3 ? 'pc-bad' : ''));
      return `<tr class="${tone}"><td><b>#${row.rank}</b></td><td><b>${esc(row.name)}</b><br><small class="muted">${esc(row.sow_id || '')}</small></td><td>${row.parity}</td><td>${esc(row.status || '—')}</td><td>${row.farrowings}</td><td>${formatNumber(row.born, 0)}</td><td>${formatNumber(row.weaned, 0)}</td><td>${formatNumber(row.born_per_litter)}</td><td>${formatNumber(row.weaned_per_litter)}</td><td>${formatRate(row.mortality_rate)}</td><td><b>${row.internal_score == null ? '—' : row.internal_score.toFixed(1)}</b></td></tr>`;
    }).join('');

    const parityRows = parity.map(row => `<tr><td><b>Parity ${row.parity}</b></td><td>${row.sows}</td><td>${row.services}</td><td>${row.farrowings}</td><td>${formatRate(row.farrowing_rate)}</td><td>${formatNumber(row.born_per_farrowing)}</td><td>${formatRate(row.weaning_rate)}</td><td>${formatRate(row.mortality_rate)}</td></tr>`).join('');

    return `<section id="kpiCenter" class="production-control-center">
      <div class="pc-header panel"><div><div class="eyebrow">KPI CENTER · ${APP_VERSION}</div><h2>Farm performance command deck</h2><p class="muted">Farrowing, mortality, growth efficiency, benchmark scoring and the sow league — computed live from your recorded production events.</p></div><div class="pc-header-actions">${periodSelect}<button type="button" class="btn ghost" onclick="window.openKpiDefinitions()">ⓘ Definitions</button><button type="button" class="btn ghost" onclick="window.openDataQualityReport()">⚠ Data quality</button><button type="button" class="btn ghost" onclick="go('production')">◷ Production Forecast</button></div></div>

      <div class="pc-kpi-grid">
        ${kpiCard('Farrowing rate', formatRate(k.farrowing_rate), `${k.farrowings} farrowings / ${k.services} services`, k.farrowing_rate === null ? 'warn' : '')}
        ${kpiCard('Pre-weaning mortality', formatRate(k.preweaning_mortality_rate), `${formatNumber(k.preweaning_mortality, 0)} pre-weaning deaths / ${formatNumber(k.born, 0)} born`, k.preweaning_mortality_rate !== null && k.preweaning_mortality_rate > .1 ? 'warn' : '')}
        ${kpiCard('Average born / farrowing', formatNumber(k.average_born_per_farrowing), `${formatNumber(k.born, 0)} born across ${k.farrowings} farrowings`)}
        ${kpiCard('Pigs weaned / sow / year', formatNumber(k.pigs_weaned_per_sow_per_year), `${formatNumber(k.weaned, 0)} weaned · ${k.active_sows} active sows`)}
        ${kpiCard('Feed delivered', `${formatNumber(k.feed_delivered_kg)} kg`, `${formatMoney(k.feed_purchase_cost)} purchase cost`)}
        ${kpiCard('Feed allocated / COGS', `${formatNumber(k.feed_allocated_kg)} kg`, `${formatMoney(k.feed_cogs)} actual allocated cost`, k.feed_allocated_kg ? '' : 'warn')}
        ${kpiCard('Feed cost / kg', k.feed_cost_per_allocated_kg == null ? '—' : formatMoney(k.feed_cost_per_allocated_kg), k.feed_cost_per_allocated_kg == null ? 'Allocate actual consumption to measure' : 'weighted average cost basis')}
        ${kpiCard('Mortality rate', formatRate(k.mortality_rate), `${formatNumber(k.mortality, 0)} mortality events/heads`, k.mortality_rate > .1 ? 'warn' : '')}
      </div>

      <div class="panel pc-section pc-intelligence"><div class="pc-section-head"><div><h3>Growth efficiency &amp; population reconciliation</h3><p class="muted">13-week scope · measured weight gain, feed conversion and headcount math.</p></div><button type="button" class="btn ghost" onclick="window.openPopulationReconciliation()">＋ Headcount snapshot</button></div><div class="pc-intel-kpis">${kpiCard('Ending piglet headcount', formatNumber(reconciliation.observedEnding, 0), reconciliation.startingSource.replace(/_/g, ' '))}${kpiCard('Weight gain', growth.total_gain_kg == null ? '—' : `${Number(growth.total_gain_kg).toFixed(1)} kg`, growth.total_gain_kg == null ? 'Requires measured start/current weight' : 'measured gain across tracked batches')}${kpiCard('FCR', growth.fcr == null ? '—' : Number(growth.fcr).toFixed(2), growth.fcr == null ? 'Requires feed and measured weight gain' : 'kg feed ÷ kg weight gain')}${kpiCard('ADG', growth.adg_kg_per_day == null ? '—' : `${Number(growth.adg_kg_per_day).toFixed(3)} kg/day`, growth.adg_kg_per_day == null ? 'Requires dated weights' : 'weight gain ÷ days')}${kpiCard('Feed cost efficiency', growth.feed_cost_efficiency == null ? '—' : formatMoney(growth.feed_cost_efficiency), growth.feed_cost_efficiency == null ? 'Requires feed cost and weight gain' : 'PHP per kg gain')}${kpiCard('Production index', index.score === null ? 'Not benchmarked' : `${index.score.toFixed(1)} / 100`, index.score === null ? 'Import a benchmark profile' : `${Math.round(index.coverage * 100)}% weighted coverage`, index.score === null ? 'warn' : '')}</div><div class="pc-recon-line"><span><b>Starting</b> ${formatNumber(reconciliation.starting, 0)}</span><span>＋ <b>Entries</b> ${formatNumber(reconciliation.entries, 0)}</span><span>− <b>Mortality</b> ${formatNumber(reconciliation.mortality, 0)}</span><span>− <b>Transfers</b> ${formatNumber(reconciliation.transfers, 0)}</span><span>− <b>Sales</b> ${formatNumber(reconciliation.sales, 0)}</span><span>＝ <b>Expected ending</b> ${formatNumber(reconciliation.expectedEnding, 0)}</span><span class="${reconciliation.variance === null ? 'pc-recon-pending' : (reconciliation.variance === 0 ? 'pc-good' : 'pc-bad')}">Variance: ${varianceText}</span></div></div>

      <div class="pc-two-col">
        <div class="panel pc-section"><div class="pc-section-head"><div><h3>↔ Period trends</h3><p class="muted">Current vs previous 13-week windows, plus the trailing 52 weeks. ▲▼ is good/bad per metric direction.</p></div><button type="button" class="btn ghost" onclick="window.openPeriodComparison()">Open full comparison</button></div><div class="table-wrap"><table class="table pc-table"><thead><tr><th>Metric</th><th>13w</th><th>Prev 13w</th><th>Δ</th><th>52w</th><th>Δ</th></tr></thead><tbody>${cmpRows}</tbody></table></div></div>
        <div class="panel pc-section"><div class="pc-section-head"><div><h3>★ Production index vs industry</h3><p class="muted">Weighted percentile score — requires an imported verified benchmark profile.</p></div><button type="button" class="btn" onclick="window.openBenchmarkImport()">⇧ Import benchmarks</button></div><div class="pc-index-score ${index.score === null ? 'pending' : ''}" style="margin:8px 0"><small>${index.period} production index</small><b>${index.score === null ? 'Not benchmarked' : `${index.score.toFixed(1)} / 100`}</b><span>${index.score === null ? 'Import p10–p90 percentiles to score this farm.' : `${Math.round(index.coverage * 100)}% weighted KPI coverage`}</span></div><div class="table-wrap"><table class="table pc-table"><thead><tr><th>Metric</th><th>Farm</th><th>p10/p50/p90</th><th>Pctl</th><th>Wt</th></tr></thead><tbody>${indexRows}</tbody></table></div>${index.score === null ? '<div class="pc-warning">Industry percentiles are intentionally not invented. Import a verified benchmark profile before publishing an industry score.</div>' : ''}</div>
      </div>

      <div class="panel pc-section"><div class="pc-section-head"><div><h3>🏆 Sow lifetime league</h3><p class="muted">Every sow ranked by born/litter, weaned/litter, weaned/sow/year and inverse mortality. <b class="pc-bad">Bottom-ranked sows eat feed without returning piglets — review them for culling.</b></p></div><button type="button" class="btn ghost" onclick="window.openSowLifetimeLeague()">Open league modal</button></div><div class="table-wrap"><table class="table pc-table"><thead><tr><th>Rank</th><th>Sow</th><th>Parity</th><th>Status</th><th>Farrowings</th><th>Born</th><th>Weaned</th><th>Born/litter</th><th>Weaned/litter</th><th>Mortality</th><th>Score</th></tr></thead><tbody>${leagueRows || '<tr><td colspan="11" class="empty">No sow lifetime records available.</td></tr>'}</tbody></table></div></div>

      <div class="panel pc-section"><div class="pc-section-head"><div><h3>♙ Parity benchmarking</h3><p class="muted">Reproductive performance grouped by parity — spot the parity where your sows stop earning.</p></div><button type="button" class="btn ghost" onclick="window.openParityBenchmark()">Open parity modal</button></div><div class="table-wrap"><table class="table pc-table"><thead><tr><th>Parity</th><th>Sows</th><th>Services</th><th>Farrowings</th><th>Farrowing rate</th><th>Born/farrowing</th><th>Weaning rate</th><th>Mortality</th></tr></thead><tbody>${parityRows || '<tr><td colspan="8" class="empty">No active sows recorded.</td></tr>'}</tbody></table></div></div>

      <div class="pc-report-actions"><button type="button" class="btn ghost" onclick="window.openCohortReport()">▦ Cohort report</button><button type="button" class="btn ghost" onclick="window.openProductionEventLedger()">▤ Event ledger</button><button type="button" class="btn ghost" onclick="window.openAuditLog()">🛡 Audit log</button><button type="button" class="btn ghost" onclick="window.openIntegrationHub()">↔ Integrations</button></div>
    </section>`;
  }

  function renderKpiCenter() {
    const host = document.getElementById('kpis');
    if (!host || !host.classList.contains('active')) return; /* [FIX 72] off-screen = no work */
    const key = pcRevKey('kpi');
    if (pcMemo.kpiKey !== key) {
      pcMemo.kpiKey = key;
      pcMemo.kpiHtml = kpiCenterHTML(farm() || {});
    }
    if (host.innerHTML === pcMemo.kpiHtml) return;
    host.innerHTML = pcMemo.kpiHtml;
    pcMemo.kpiWritten = pcMemo.kpiHtml;
  }
  window.renderKpiCenter = renderKpiCenter;

  function modalShell(idValue, title, body) {
    document.getElementById(idValue)?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open pc-modal-bg" id="${idValue}" onclick="if(event.target===this)this.remove()"><div class="due-modal pc-modal"><div class="modal-top"><div><div class="eyebrow">PRODUCTION CONTROL</div><h2>${title}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('${idValue}')?.remove()">×</button></div>${body}</div></div>`);
  }

  function openKpiDefinitions() {
    const rows = Object.values(KPI_DEFINITIONS).map(definition => `<tr><td><b>${esc(definition.label)}</b></td><td><code>${esc(definition.formula)}</code></td><td>${esc(definition.note)}</td></tr>`).join('');
    modalShell('kpiDefinitionsModal', 'Standardized KPI definitions', `<p class="muted">These formulas are intentionally explicit. A missing denominator is shown as “—” instead of being silently treated as a successful rate.</p><div class="table-wrap"><table class="table pc-table"><thead><tr><th>KPI</th><th>Formula</th><th>Interpretation</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  function openProductionEventLedger() {
    const f = farm() || {};
    const rows = allEvents(f).sort((a, b) => String(b.event_date).localeCompare(String(a.event_date))).slice(0, 250);
    modalShell('productionEventLedgerModal', 'Canonical production event ledger', `<p class="muted">Derived legacy events are labeled and are not silently written back. Canonical events can be voided with a reason.</p><div class="pc-modal-actions"><button type="button" class="btn" onclick="window.openProductionEventForm()">＋ Record canonical event</button><button type="button" class="btn ghost" onclick="window.exportProductionEvents()">⇩ Export CSV</button></div><div class="table-wrap pc-event-table"><table class="table"><thead><tr><th>Date</th><th>Event</th><th>Subject</th><th>Qty</th><th>Source</th><th>Action</th></tr></thead><tbody>${rows.map(event => `<tr><td>${esc(event.event_date)}</td><td><b>${esc(eventLabel(event.event_type))}</b><br><small class="muted">${esc(event.id)}</small></td><td>${esc(event.subject_id || event.batch_id || '—')}</td><td>${event.quantity == null ? '—' : `${formatNumber(event.quantity)} ${esc(event.unit || '')}`}</td><td><span class="tag ${event.source === 'legacy_derived' ? 'warn' : ''}">${esc(event.source || 'manual')}</span></td><td>${event.source === 'legacy_derived' ? '<small class="muted">Derived only</small>' : `<button type="button" class="btn ghost small" onclick="window.voidProductionEventPrompt('${esc(event.id)}')">Void</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No events recorded yet.</td></tr>'}</tbody></table></div>`);
  }

  function openProductionEventForm() {
    const eventOptions = Object.entries(EVENT_TYPES).filter(([key]) => !['event_voided', 'custom'].includes(key)).map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('');
    const f = farm() || {};
    const batchOptions = (f.piglets || []).filter(batch => !batch.archived).map(batch => `<option value="${esc(batch.id)}">${esc(batch.id)} · ${esc(batch.dam_name || batch.sow || '')}</option>`).join('');
    modalShell('productionEventFormModal', 'Record canonical production event', `<form class="pc-form" onsubmit="window.saveProductionEventForm(event)"><div class="pc-form-grid"><div class="field"><label>Event type *</label><select name="event_type" required>${eventOptions}</select></div><div class="field"><label>Event date *</label><input name="event_date" type="date" value="${today()}" required></div><div class="field"><label>Subject type</label><select name="subject_type"><option value="sow">Sow</option><option value="piglet_batch">Piglet batch</option><option value="boar">Boar</option><option value="animal">Animal</option><option value="group">Group</option><option value="feed_inventory">Feed</option></select></div><div class="field"><label>Subject ID / batch ID</label><input name="subject_id" list="pcBatchOptions" placeholder="e.g. S-001 or B-001"><datalist id="pcBatchOptions">${batchOptions.replace(/<option/g, '<option')}</datalist></div><div class="field"><label>Quantity</label><input name="quantity" type="number" min="0" step="0.01" placeholder="head, kg, bottles…"></div><div class="field"><label>Unit</label><input name="unit" placeholder="head, kg, bottle, service"></div><div class="field"><label>Feed type</label><input name="feed_type" list="pcFeedOptions" placeholder="Only for feed events"><datalist id="pcFeedOptions">${(f.feed || []).map(row => `<option value="${esc(row.type)}">`).join('')}</datalist></div><div class="field"><label>Amount (₱)</label><input name="amount" type="number" min="0" step="0.01"></div><div class="field full"><label>Cause / notes</label><textarea name="details" placeholder="Clinical reason, movement note, source reference…"></textarea></div></div><div class="form-error" id="pcEventFormError"></div><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('productionEventFormModal')?.remove()">Cancel</button><button class="btn">Save canonical event</button></div></form>`);
  }

  function saveProductionEventForm(event) {
    event.preventDefault();
    const form = event.target;
    try {
      const data = Object.fromEntries(new FormData(form));
      recordProductionEvent({
        event_type: data.event_type,
        event_date: data.event_date,
        subject_type: data.subject_type,
        subject_id: data.subject_id,
        quantity: data.quantity === '' ? null : num(data.quantity),
        unit: data.unit,
        feed_type: data.feed_type,
        amount: data.amount === '' ? null : num(data.amount),
        source: 'manual',
        details: { notes: data.details || '' }
      });
      document.getElementById('productionEventFormModal')?.remove();
      openProductionEventLedger();
      window.renderAll?.();
      toast('Canonical production event recorded');
    } catch (error) {
      const box = document.getElementById('pcEventFormError');
      if (box) { box.textContent = error.message || 'Could not record event.'; box.classList.add('show'); }
    }
  }

  function voidProductionEventPrompt(eventId) {
    const reason = prompt('Enter the reason for voiding this event. The original event will remain in the audit ledger:');
    if (reason === null) return;
    try {
      voidProductionEvent(eventId, reason);
      openProductionEventLedger();
      toast('Event voided with a compensating audit event');
    } catch (error) { toast(error.message || 'Could not void event.'); }
  }

  function openFeedAllocationModal() {
    const f = farm() || {};
    const feedOptions = (f.feed || []).map(row => `<option value="${esc(row.type)}">${esc(row.type)} · ${formatNumber(row.bags, 2)} bags</option>`).join('');
    const batchOptions = (f.piglets || []).filter(batch => !batch.archived).map(batch => `<option value="${esc(batch.id)}">${esc(batch.id)} · ${esc(batch.dam_name || batch.sow || '')}</option>`).join('');
    modalShell('feedAllocationModal', 'Allocate actual feed consumption', `<form class="pc-form" onsubmit="window.saveFeedAllocationForm(event)"><p class="muted">This records actual consumption separately from feed purchased. It becomes Feed COGS using the weighted-average cost of recorded deliveries.</p><div class="pc-form-grid"><div class="field"><label>Feed type *</label><select name="feed_type" required><option value="">Select feed…</option>${feedOptions}</select></div><div class="field"><label>Allocation date *</label><input name="allocation_date" type="date" value="${today()}" required></div><div class="field"><label>Quantity consumed (kg) *</label><input name="quantity_kg" type="number" min="0.01" step="0.01" required placeholder="e.g. 125.5"></div><div class="field"><label>Target type</label><select name="target_type"><option value="piglet_batch">Piglet batch</option><option value="sow_group">Sow group</option><option value="boar_group">Boar group</option><option value="farm_use">Farm use</option><option value="other">Other</option></select></div><div class="field full"><label>Target batch / group</label><input name="target_id" list="pcAllocationBatches" placeholder="Select or type a batch/group"><datalist id="pcAllocationBatches">${batchOptions}</datalist></div><div class="field"><label>Headcount at feeding</label><input name="headcount" type="number" min="0" step="1"></div><div class="field full"><label>Notes</label><textarea name="note" placeholder="Pen, ration, staff or delivery reference…"></textarea></div></div><div class="form-error" id="pcFeedFormError"></div><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('feedAllocationModal')?.remove()">Cancel</button><button class="btn">Save allocation</button></div></form>`);
  }

  function saveFeedAllocationForm(event) {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target));
      appendFeedAllocation(data);
      document.getElementById('feedAllocationModal')?.remove();
      window.renderAll?.();
      toast('Actual feed consumption allocated and costed');
    } catch (error) {
      const box = document.getElementById('pcFeedFormError');
      if (box) { box.textContent = error.message || 'Could not save feed allocation.'; box.classList.add('show'); }
    }
  }

  function openAuditLog() {
    const f = farm() || {};
    const rows = (f.auditLog || []).slice(0, 300);
    modalShell('auditLogModal', 'Append-only application audit log', `<p class="muted">Audit records are retained locally and synchronized as farm-scoped audit_event records. The UI does not provide delete or overwrite controls.</p><div class="table-wrap pc-audit-table"><table class="table"><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Actor</th><th>Changed fields</th><th>Source</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(String(row.occurred_at || '').replace('T', ' ').slice(0, 19))}</td><td><span class="tag ${row.action === 'delete' ? 'danger' : ''}">${esc(row.action)}</span></td><td><b>${esc(row.entity_type)}</b><br><small>${esc(row.entity_id)}</small></td><td>${esc(row.recorded_by_email || row.recorded_by || 'Unknown')}<br><small class="muted">${esc(row.device_id || '')}</small></td><td>${esc((row.changed_fields || []).join(', ') || 'event append')}</td><td>${esc(row.source || 'application')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No audit records yet. Save a change or record an event to begin the trail.</td></tr>'}</tbody></table></div>`);
  }

  function openDataQualityReport() {
    const f = farm() || {};
    const rows = dataQualityReport(f);
    modalShell('dataQualityModal', 'Data-quality review', `<p class="muted">Review and correct source records before relying on KPIs or cost allocation. This report is read-only.</p><div class="table-wrap"><table class="table"><thead><tr><th>Dataset</th><th>Total</th><th>Needs review</th><th>Quality</th></tr></thead><tbody>${rows.map(row => `<tr><td><b>${esc(row.label)}</b><br><small class="muted">${esc(row.key)}</small></td><td>${row.total}</td><td class="${row.bad ? 'pc-bad' : 'pc-good'}">${row.bad}</td><td>${row.total ? formatRate(1 - row.bad / row.total) : '—'}</td></tr>`).join('')}</tbody></table></div><div class="pc-quality-notes">${computeKpis(f, { days: Number(window.__arsKpiDays || 30) }).quality.notes.map(note => `<div class="pc-warning">⚠ ${esc(note)}</div>`).join('') || '<div class="pc-good-box">✓ No current KPI quality warnings.</div>'}</div>`);
  }

  function metricDisplay(value, unit = 'number') {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    if (unit === 'rate') return formatRate(value);
    if (unit === 'money') return formatMoney(value);
    if (unit === 'kg') return `${Number(value).toFixed(3)} kg/day`;
    return Number(value).toFixed(2);
  }

  function openPopulationReconciliation() {
    const f = farm() || {};
    const report = computePopulationReconciliation(f, { days: 13 * 7, scope: 'piglet_batch' });
    const snapshotRows = (f.populationSnapshots || []).slice().sort((a, b) => String(b.snapshot_date || b.date).localeCompare(String(a.snapshot_date || a.date))).slice(0, 30).map(snapshot => `<tr><td>${esc(snapshot.snapshot_date || snapshot.date)}</td><td>${esc(snapshot.scope || 'piglet_batch')}</td><td>${formatNumber(snapshot.headcount, 0)}</td><td>${esc(snapshot.recorded_by_email || '—')}</td><td>${esc(snapshot.note || '')}</td></tr>`).join('');
    modalShell('populationReconciliationModal', 'Population reconciliation', `<p class="muted">Formula: <b>Starting headcount + entries − mortality − transfers − sales = ending headcount.</b> A verified snapshot makes the variance independently testable; without one, the starting figure is only derived from the observed ending count.</p><div class="pc-recon-detail"><div><small>Starting</small><b>${formatNumber(report.starting, 0)}</b><span>${esc(report.startingSource.replace(/_/g, ' '))}</span></div><div><small>Entries</small><b>＋ ${formatNumber(report.entries, 0)}</b><span>birth/farrowing/transfer in</span></div><div><small>Mortality</small><b>− ${formatNumber(report.mortality, 0)}</b><span>active mortality events</span></div><div><small>Transfers</small><b>− ${formatNumber(report.transfers, 0)}</b><span>out/foster out</span></div><div><small>Sales</small><b>− ${formatNumber(report.sales, 0)}</b><span>sale events</span></div><div><small>Observed ending</small><b>${formatNumber(report.observedEnding, 0)}</b><span>${report.variance === null ? 'snapshot required' : `variance ${formatNumber(report.variance, 0)}`}</span></div></div><h3 class="pc-modal-subhead">Record verified headcount snapshot</h3><form class="pc-form" onsubmit="window.savePopulationSnapshotForm(event)"><div class="pc-form-grid"><div class="field"><label>Snapshot date *</label><input name="snapshot_date" type="date" value="${today()}" required></div><div class="field"><label>Scope</label><select name="scope"><option value="piglet_batch">Piglet batches</option><option value="sows">Sows</option><option value="boars">Boars</option><option value="all">All managed animals</option></select></div><div class="field"><label>Verified headcount *</label><input name="headcount" type="number" min="0" step="1" required></div><div class="field"><label>Verification source</label><input name="source" placeholder="Barn count, RFID count, stocktake…"></div><div class="field full"><label>Notes</label><textarea name="note" placeholder="Who counted, barn/pen scope, reconciliation reference…"></textarea></div></div><div class="form-error" id="pcSnapshotError"></div><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('populationReconciliationModal')?.remove()">Close</button><button class="btn">Save verified snapshot</button></div></form><h3 class="pc-modal-subhead">Recent snapshots</h3><div class="table-wrap"><table class="table pc-table"><thead><tr><th>Date</th><th>Scope</th><th>Headcount</th><th>Recorded by</th><th>Notes</th></tr></thead><tbody>${snapshotRows || '<tr><td colspan="5" class="empty">No verified snapshots recorded yet.</td></tr>'}</tbody></table></div>`);
  }

  function savePopulationSnapshotForm(event) {
    event.preventDefault();
    const form = event.target;
    try {
      const data = Object.fromEntries(new FormData(form));
      const f = farm();
      ensureArrays(f);
      const snapshot = { id: id('snapshot'), snapshot_date: iso(data.snapshot_date), scope: data.scope || 'piglet_batch', headcount: num(data.headcount), source: safeText(data.source || 'manual_stocktake'), note: safeText(data.note), created_at: now(), ...actorFields() };
      if (!snapshot.snapshot_date || snapshot.headcount < 0) throw new Error('Enter a valid date and non-negative headcount.');
      f.populationSnapshots.unshift(snapshot);
      audit(f, 'create', 'population_snapshot', snapshot.id, null, snapshot, { source: 'manual_stocktake' });
      window.save?.();
      openPopulationReconciliation();
      window.renderAll?.();
      toast('Verified population snapshot saved');
    } catch (error) {
      const box = document.getElementById('pcSnapshotError');
      if (box) { box.textContent = error.message || 'Could not save snapshot.'; box.classList.add('show'); }
    }
  }

  function openCohortReport() {
    const f = farm() || {};
    const rows = computeCohortReport(f, { mode: 'quarter', from: '1970-01-01', to: today() });
    const html = rows.map(row => `<tr><td><b>${esc(row.cohort)}</b></td><td>${row.batches.length}</td><td>${formatNumber(row.born, 0)}</td><td>${formatNumber(row.live, 0)}</td><td>${formatNumber(row.mortality, 0)}<br><small>${formatRate(row.mortality_rate)}</small></td><td>${formatNumber(row.weaned, 0)}</td><td>${formatNumber(row.sold, 0)}</td><td>${row.adg == null ? '—' : `${Number(row.adg).toFixed(3)} kg/day`}</td><td>${row.fcr == null ? '—' : Number(row.fcr).toFixed(2)}</td><td>${row.feed_cost_efficiency == null ? '—' : formatMoney(row.feed_cost_efficiency)}</td></tr>`).join('');
    modalShell('cohortReportModal', 'Cohort report', `<p class="muted">Cohorts are grouped by farrowing/birth quarter. Weight, FCR and feed-cost metrics appear only where dated weights and feed records exist.</p><div class="pc-modal-actions"><button type="button" class="btn ghost" onclick="window.exportCohortReport()">⇩ Export CSV</button></div><div class="table-wrap pc-wide-table"><table class="table"><thead><tr><th>Cohort</th><th>Batches</th><th>Born</th><th>Live</th><th>Mortality</th><th>Weaned</th><th>Sold</th><th>ADG</th><th>FCR</th><th>Feed cost/kg gain</th></tr></thead><tbody>${html || '<tr><td colspan="10" class="empty">No dated piglet cohorts available.</td></tr>'}</tbody></table></div>`);
  }

  function exportCohortReport() {
    const rows = computeCohortReport(farm() || {}, { mode: 'quarter', from: '1970-01-01', to: today() });
    const headers = ['cohort', 'batches', 'born', 'live', 'mortality', 'mortality_rate', 'weaned', 'sold', 'adg_kg_per_day', 'fcr', 'feed_cost_efficiency'];
    const content = [headers.join(',')].concat(rows.map(row => headers.map(key => csvEscape(row[key])).join(','))).join('\n');
    downloadText(`arswinetech-cohort-report-${today()}.csv`, content);
  }

  function openParityBenchmark() {
    const rows = computeParityReport(farm() || {}, { from: '1970-01-01', to: today() });
    const html = rows.map(row => `<tr><td><b>${row.parity === 0 ? 'Gilt / parity 0' : row.parity}</b></td><td>${row.sows}</td><td>${row.services}</td><td>${row.farrowings}</td><td>${formatRate(row.farrowing_rate)}</td><td>${formatNumber(row.born_per_farrowing)}</td><td>${formatNumber(row.weaned, 0)}</td><td>${formatRate(row.weaning_rate)}</td><td>${formatRate(row.mortality_rate)}</td></tr>`).join('');
    modalShell('parityBenchmarkModal', 'Parity benchmarking', `<p class="muted">This compares parity groups inside this farm. It is an internal parity comparison, not an industry percentile until a verified benchmark profile is imported.</p><div class="table-wrap pc-wide-table"><table class="table"><thead><tr><th>Parity</th><th>Sows</th><th>Services</th><th>Farrowings</th><th>Farrowing rate</th><th>Born / farrowing</th><th>Weaned</th><th>Weaning rate</th><th>Mortality rate</th></tr></thead><tbody>${html || '<tr><td colspan="9" class="empty">No parity-linked sow/batch data available.</td></tr>'}</tbody></table></div>`);
  }

  function openPeriodComparison() {
    const report = computePeriodComparison(farm() || {});
    const html = report.rows.map(row => `<tr><td><b>${esc(row.label)}</b></td><td>${metricDisplay(row.current13, row.unit)}</td><td>${metricDisplay(row.previous13, row.unit)}</td><td class="${row.change13.change !== null && row.change13.change < 0 ? 'pc-bad' : 'pc-good'}">${row.change13.change === null ? '—' : `${row.change13.change >= 0 ? '+' : ''}${(row.change13.change * 100).toFixed(1)}%`}</td><td>${metricDisplay(row.current52, row.unit)}</td><td>${metricDisplay(row.previous52, row.unit)}</td><td class="${row.change52.change !== null && row.change52.change < 0 ? 'pc-bad' : 'pc-good'}">${row.change52.change === null ? '—' : `${row.change52.change >= 0 ? '+' : ''}${(row.change52.change * 100).toFixed(1)}%`}</td></tr>`).join('');
    modalShell('periodComparisonModal', '13-week and 52-week production comparison', `<p class="muted">Current periods are compared with the immediately preceding period of equal length. For mortality, FCR and feed cost, lower values are generally better; review the direction with the KPI definition.</p><div class="table-wrap pc-wide-table"><table class="table"><thead><tr><th>Metric</th><th>Current 13w</th><th>Previous 13w</th><th>13w change</th><th>Current 52w</th><th>Previous 52w</th><th>52w change</th></tr></thead><tbody>${html}</tbody></table></div>`);
  }

  function openProductionIndex() {
    const result = computeProductionIndex(farm() || {}, { period: '52w' });
    const html = result.scored.map(row => `<tr><td><b>${esc(KPI_DEFINITIONS[row.kpi]?.label || row.kpi)}</b></td><td>${row.value == null ? '—' : row.value}</td><td>${row.profile ? `${row.profile.p10 ?? '—'} / ${row.profile.p50 ?? '—'} / ${row.profile.p90 ?? '—'}` : '<span class="tag warn">No profile</span>'}</td><td>${row.percentile == null ? '—' : `${row.percentile.toFixed(1)} percentile score`}</td><td>${(row.weight * 100).toFixed(0)}%</td></tr>`).join('');
    modalShell('productionIndexModal', 'Standardized production-index scoring', `<p class="muted">The index is a weighted score, not a clinical or financial truth. It requires a verified benchmark profile. Lower-is-better metrics such as mortality, FCR and feed cost are inverted before scoring.</p><div class="pc-index-score ${result.score === null ? 'pending' : ''}"><small>52-week production index</small><b>${result.score === null ? 'Not benchmarked' : `${result.score.toFixed(1)} / 100`}</b><span>${result.score === null ? 'Import p10/p25/p50/p75/p90 values for the selected industry scope.' : `${Math.round(result.coverage * 100)}% weighted KPI coverage`}</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Metric</th><th>Farm value</th><th>Industry p10 / p50 / p90</th><th>Score</th><th>Weight</th></tr></thead><tbody>${html}</tbody></table></div><div class="pc-modal-actions"><button type="button" class="btn" onclick="document.getElementById('productionIndexModal')?.remove();window.openBenchmarkImport()">⇧ Import benchmark profile</button></div>`);
  }

  function openSowLifetimeLeague() {
    const rows = computeSowLifetimeLeague(farm() || {});
    const html = rows.map(row => `<tr><td><b>#${row.rank}</b></td><td><b>${esc(row.name)}</b><br><small>${esc(row.sow_id || '')}</small></td><td>${row.parity}</td><td>${row.status ? esc(row.status) : '—'}</td><td>${row.farrowings}</td><td>${formatNumber(row.born, 0)}</td><td>${formatNumber(row.weaned, 0)}</td><td>${formatNumber(row.born_per_litter)}</td><td>${formatNumber(row.weaned_per_litter)}</td><td>${formatRate(row.mortality_rate)}</td><td>${row.internal_score == null ? '—' : row.internal_score.toFixed(1)}</td></tr>`).join('');
    modalShell('sowLifetimeLeagueModal', 'Full sow-lifetime performance league', `<p class="muted">Rank is an internal farm league based on born/litter, weaned/litter, weaned/sow/year and inverse mortality. It is not an external industry ranking.</p><div class="table-wrap pc-wide-table"><table class="table"><thead><tr><th>Rank</th><th>Sow</th><th>Parity</th><th>Status</th><th>Farrowings</th><th>Born</th><th>Weaned</th><th>Born/litter</th><th>Weaned/litter</th><th>Mortality</th><th>Internal score</th></tr></thead><tbody>${html || '<tr><td colspan="11" class="empty">No sow lifetime records available.</td></tr>'}</tbody></table></div>`);
  }

  function benchmarkCsvTemplate() {
    return 'kpi,scope,period,p10,p25,p50,p75,p90,unit,source,as_of\nfarrowing_rate,industry,52w,,,,,,rate,verified_source,YYYY-MM-DD\npigs_weaned_per_sow_per_year,industry,52w,,,,,,head_per_sow_year,verified_source,YYYY-MM-DD\npreweaning_mortality_rate,industry,52w,,,,,,rate,verified_source,YYYY-MM-DD\nadg_kg_per_day,industry,52w,,,,,,kg_per_day,verified_source,YYYY-MM-DD\nfcr,industry,52w,,,,,,ratio,verified_source,YYYY-MM-DD\nfeed_cost_efficiency,industry,52w,,,,,,PHP_per_kg_gain,verified_source,YYYY-MM-DD';
  }

  function openBenchmarkImport() {
    const f = farm() || {};
    modalShell('benchmarkImportModal', 'Import verified industry benchmark percentiles', `<p class="muted">Do not use invented values. Import a source-approved dataset with p10, p25, p50, p75 and p90 for each KPI. Existing benchmark profiles are preserved as history; a new import becomes the current profile.</p><div class="pc-modal-actions"><button type="button" class="btn ghost" onclick="window.downloadBenchmarkTemplate()">⇩ Download CSV template</button></div><div class="pc-integration-card"><b>Required columns</b><small>kpi, scope, period, p10, p25, p50, p75, p90, unit, source, as_of</small><input type="file" accept=".csv,text/csv" onchange="window.importBenchmarkCsv(event)"></div><div class="pc-summary-strip"><span>Profiles stored <b>${f.benchmarkProfiles?.length || 0}</b></span><span>Use period values <b>13w or 52w</b></span></div>`);
  }

  function downloadBenchmarkTemplate() {
    downloadText('arswinetech-benchmark-template.csv', benchmarkCsvTemplate());
  }

  function importBenchmarkCsv(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsv(String(reader.result || ''));
        const f = farm();
        ensureArrays(f);
        let imported = 0;
        const seen = new Set();
        rows.forEach(row => {
          const kpi = safeText(row.kpi || row.metric);
          const scope = safeText(row.scope || 'industry');
          const period = safeText(row.period || '52w');
          const profileKey = `${scope}:${period}:${kpi}`;
          if (!kpi || seen.has(profileKey)) return;
          const points = ['p10', 'p25', 'p50', 'p75', 'p90'].map(key => num(row[key]));
          if (points.some(value => !Number.isFinite(value))) throw new Error(`Benchmark ${kpi} is missing one or more percentile values.`);
          for (let i = 1; i < points.length; i++) if (points[i] < points[i - 1]) throw new Error(`Benchmark ${kpi} percentiles must be ascending from p10 to p90.`);
          const profile = { id: id('benchmark'), kpi, scope, period, p10: points[0], p25: points[1], p50: points[2], p75: points[3], p90: points[4], unit: safeText(row.unit), source: safeText(row.source || file.name), as_of: safeText(row.as_of), imported_at: now(), ...actorFields() };
          f.benchmarkProfiles.unshift(profile);
          audit(f, 'benchmark_import', 'benchmark_profile', profile.id, null, profile, { source: 'benchmark_csv_import' });
          seen.add(profileKey);
          imported++;
        });
        const receipt = { id: id('integration'), integration_type: 'benchmark_csv_import', source: file.name, imported, received_at: now(), ...actorFields() };
        f.integrationEvents.unshift(receipt);
        audit(f, 'integration_import', 'integration_event', receipt.id, null, receipt, { source: 'benchmark_csv_import' });
        window.save?.();
        document.getElementById('benchmarkImportModal')?.remove();
        window.renderAll?.();
        toast(`Imported ${imported} verified benchmark profile${imported === 1 ? '' : 's'}.`);
      } catch (error) { toast(error.message || 'Benchmark import failed.'); }
    };
    reader.readAsText(file);
  }

  function downloadText(name, content, type = 'text/csv') {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportProductionEvents() {
    downloadText(`arswinetech-production-events-${today()}.csv`, eventCsv(farm() || {}));
  }

  function openIntegrationHub() {
    const f = farm() || {};
    const body = `<p class="muted">This integration boundary accepts append-only canonical events. It never overwrites existing sow, batch, feed or financial records. External systems can later send the same event shape through <code>ARSIntegration.ingestEvent()</code>.</p><div class="pc-integration-grid"><div class="pc-integration-card"><b>📥 Import canonical event CSV</b><small>Columns: event_type, event_date, subject_type, subject_id, batch_id, feed_type, quantity, unit, amount, source_record_id, idempotency_key.</small><input type="file" accept=".csv,text/csv" onchange="window.importProductionCsv(event)"></div><div class="pc-integration-card"><b>📤 Export canonical events</b><small>Creates a CSV snapshot for feed mills, RFID vendors, accountants or a future API adapter.</small><button type="button" class="btn" onclick="window.exportProductionEvents()">Download event CSV</button></div><div class="pc-integration-card"><b>📡 Integration adapters</b><small>RFID, barcode, Bluetooth scale, feed delivery and packer adapters should call the canonical event boundary rather than writing directly into legacy arrays.</small><code>ARSIntegration.ingestEvent(payload, source)</code></div></div><div class="pc-summary-strip"><span>Integration receipts <b>${(f.integrationEvents || []).length}</b></span><span>Canonical events <b>${(f.productionEvents || []).length}</b></span><span>Feed allocations <b>${(f.feedAllocations || []).length}</b></span></div>`;
    modalShell('integrationHubModal', 'Integration and data-exchange hub', body);
  }

  function importProductionCsv(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importCsv(String(reader.result || ''), { source: file.name });
        document.getElementById('integrationHubModal')?.remove();
        window.renderAll?.();
        toast(`Imported ${result.imported} event(s); skipped ${result.skipped} duplicate(s).`);
      } catch (error) { toast(error.message || 'CSV import failed.'); }
    };
    reader.readAsText(file);
  }

  function wrapProductionPage() {
    const previous = window.production;
    if (typeof previous !== 'function' || previous.__arsProductionControlWrapped) return;
    const wrapped = function () {
      const result = previous.apply(this, arguments);
      setTimeout(appendControlCenter, 0);
      return result;
    };
    wrapped.__arsProductionControlWrapped = true;
    window.production = wrapped;
  }

  // Adjust the financial report only when actual feed allocations exist. Until
  // then, the legacy purchase-expense view remains visible with a warning.
  function wrapFinance() {
    if (!window.ARSFinance || window.ARSFinance.__arsFeedCostWrapped) return;
    const base = window.ARSFinance.summary;
    const wrapped = function (f, monthKey) {
      const summary = base(f, monthKey);
      /* [REBUILD FIX 78] scope the costing to the same period the statement
         reports (the current month when provided). Switch to allocated COGS
         ONLY when the farm actually allocated most (≥50%) of the period's
         delivered feed — a stray test allocation must never replace the real
         purchase expenses the manager recorded. */
      const scope = monthKey
        ? { from: monthKey + '-01', to: monthKey + '-31' }
        : { from: '1970-01-01', to: '2999-12-31' };
      const costing = computeFeedCosting(f || {}, scope);
      summary.feedPurchaseCost = summary.feed;
      summary.feedCosting = costing;
      const adopted = costing.allocatedKg > 0 && costing.deliveredKg > 0 && costing.allocatedKg >= costing.deliveredKg * 0.5;
      if (adopted) {
        summary.feed = costing.allocatedCost;
        summary.operatingExpenses = Math.max(0, summary.operatingExpenses - summary.feedPurchaseCost + summary.feed);
        summary.netProfit = summary.grossSales - summary.operatingExpenses;
        summary.feedAccountingMode = 'allocated_cogs';
      } else {
        summary.feedAccountingMode = costing.allocatedKg > 0 ? 'purchase_expense_partial_allocation' : 'purchase_expense_pending_allocation';
      }
      return summary;
    };
    window.ARSFinance.summary = wrapped;
    window.ARSFinance.__arsFeedCostWrapped = true;
  }

  window.ARSProduction = {
    APP_VERSION,
    EVENT_TYPES,
    KPI_DEFINITIONS,
    canonicalEvent,
    recordProductionEvent,
    appendFeedAllocation,
    voidProductionEvent,
    activeEvents,
    allEvents,
    computeKpis,
    computeFeedCosting,
    computePopulationReconciliation,
    computeGrowthAggregate,
    computeCohortReport,
    computeParityReport,
    computePeriodComparison,
    computeProductionIndex,
    computeSowLifetimeLeague,
    dataQualityReport,
    importCsv,
    eventCsv,
    audit
  };
  window.ARSIntegration = {
    ingestEvent(payload, source = 'external_api') {
      return recordProductionEvent({ ...payload, source: source || 'external_api' });
    },
    ingestFeedDelivery(payload, source = 'feed_mill') {
      return recordProductionEvent({ ...payload, event_type: 'feed_delivery', source: source || 'feed_mill' });
    },
    ingestRfidEvent(payload) {
      return recordProductionEvent({ ...payload, source: 'rfid' });
    },
    ingestScaleReading(payload) {
      return recordProductionEvent({ ...payload, source: 'bluetooth_scale' });
    }
  };
  window.ARSProductionOnSave = function (activeId, previous, current) {
    if (!current || String(activeId) !== activeFarmId()) return;
    ensureArrays(current);
    // Do not backfill silently. The KPI engine can read legacy records as
    // derived events; the audit log starts when a user saves a new change.
    if (!previous || typeof previous !== 'object') return;
    TRACKED_LEGACY_KEYS.forEach(key => {
      const before = Array.isArray(previous[key]) ? previous[key] : [];
      const after = Array.isArray(current[key]) ? current[key] : [];
      const type = key.replace(/[^a-zA-Z0-9_]/g, '_');
      const beforeMap = new Map(before.map((item, index) => [stableKey(item, type, index), item]));
      const afterMap = new Map(after.map((item, index) => [stableKey(item, type, index), item]));
      afterMap.forEach((item, recordId) => {
        const old = beforeMap.get(recordId);
        if (!old) {
          audit(current, 'create', key, recordId, null, item, { source: 'save_hook' });
          const event = legacyEvent(key, item, 0, { source: 'legacy_capture', requireDate: false });
          if (event && !hasIdempotency(current, event.idempotency_key)) current.productionEvents.unshift(event);
        } else if (payloadSignature(old) !== payloadSignature(item)) {
          audit(current, 'update', key, recordId, old, item, { source: 'save_hook' });
        }
      });
      beforeMap.forEach((item, recordId) => {
        if (!afterMap.has(recordId)) audit(current, 'delete', key, recordId, item, null, { source: 'save_hook', reason: 'Legacy record removed by existing workflow; retained in audit history.' });
      });
    });
  };

  window.setProductionKpiPeriod = setProductionKpiPeriod;

  /* [REBUILD FEATURE] keep the dedicated KPI Center page fresh on every render */
  const __arsKpiOldRenderAll = window.renderAll;
  window.renderAll = function () {
    if (typeof __arsKpiOldRenderAll === 'function') __arsKpiOldRenderAll.apply(this, arguments);
    try { renderKpiCenter(); } catch (e) { console.warn('[ARSProduction] KPI Center render skipped:', e); }
  };
  window.openKpiDefinitions = openKpiDefinitions;
  window.openPopulationReconciliation = openPopulationReconciliation;
  window.savePopulationSnapshotForm = savePopulationSnapshotForm;
  window.openCohortReport = openCohortReport;
  window.exportCohortReport = exportCohortReport;
  window.openParityBenchmark = openParityBenchmark;
  window.openPeriodComparison = openPeriodComparison;
  window.openProductionIndex = openProductionIndex;
  window.openSowLifetimeLeague = openSowLifetimeLeague;
  window.openBenchmarkImport = openBenchmarkImport;
  window.downloadBenchmarkTemplate = downloadBenchmarkTemplate;
  window.importBenchmarkCsv = importBenchmarkCsv;
  window.openProductionEventLedger = openProductionEventLedger;
  window.openProductionEventForm = openProductionEventForm;
  window.saveProductionEventForm = saveProductionEventForm;
  window.voidProductionEventPrompt = voidProductionEventPrompt;
  window.openFeedAllocationModal = openFeedAllocationModal;
  window.saveFeedAllocationForm = saveFeedAllocationForm;
  window.openAuditLog = openAuditLog;
  window.openDataQualityReport = openDataQualityReport;
  window.openIntegrationHub = openIntegrationHub;
  window.importProductionCsv = importProductionCsv;
  window.exportProductionEvents = exportProductionEvents;

  wrapProductionPage();
  setTimeout(wrapFinance, 0);
})();
