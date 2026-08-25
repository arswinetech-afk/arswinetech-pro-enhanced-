/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — Swine Veterinary Reference & Clinical Library (js/vet-library.js)
   Comprehensive Philippine swine pharmaceuticals, brand names, clinical dosages,
   withdrawal periods, and symptom-to-condition diagnostic mapping.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  /* Dose buckets: newborn | nursery (7–21 d) | weaned | grower | sow |
     lactating | boar | piglet (generic fallback) | all (global fallback). */
  const LIB = [
    /* ─── 1. ANTIBIOTICS & ANTIMICROBIALS ────────────────────────────── */
    {
      key: 'amoxicillin', name: 'Amoxicillin (LA 15%)', active: 'Amoxicillin trihydrate 150 mg/ml',
      aliases: ['amox', 'amoxyl', 'betamox', 'unisamox', 'vetrimoxin', 'clamoxyl', 'alamox', 'amoxi-vet', 'amoxicillin 15%'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Amoxicillin',
      usage: 'Broad-spectrum penicillin for respiratory infections (pneumonia, rhinitis), bacterial scours/enteritis, navel ill, joint infections, and sow MMA complex.',
      dosage: '15 mg/kg BW IM = 1 ml per 10 kg BW, repeat every 48 h (2–3 doses typical).',
      doses: {
        newborn: '0.3–0.5 ml IM, repeat after 48 h if needed.',
        nursery: '0.5–1 ml IM every 48 h.',
        weaned: '1–2 ml IM every 48 h.',
        grower: '1 ml per 10 kg BW IM every 48 h.',
        sow: '15–20 ml IM every 48 h (150–200 kg sow).',
        lactating: '15–20 ml IM every 48 h — safe during lactation.',
        boar: '15–25 ml IM every 48 h.',
        piglet: '≈1 ml per 10 kg BW IM every 48 h.'
      },
      route: 'Intramuscular (neck muscle)', withdrawal: 'Meat 18–21 days',
      price: '₱420–₱950 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['fever', 'cough', 'pneumonia', 'diarrhea', 'scours', 'wounds', 'navel infection', 'arthritis', 'swollen joints', 'mastitis', 'mma', 'rhinitis', 'pagtatae', 'lagnat', 'ubo'],
      source: 'Product label · Merck Vet Manual'
    },
    {
      key: 'oxytetracycline', name: 'Oxytetracycline (LA 20%)', active: 'Oxytetracycline dihydrate 200 mg/ml',
      aliases: ['terramycin', 'oxytet', 'tetrasol', 'oxylan', 'adamycin', 'oxytetrin', 'terramycin la', 'oxytet la', 'tetracycline'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Oxytetracycline',
      usage: 'Long-acting broad-spectrum antibiotic for pneumonia, bacterial scours, leptospirosis, foot rot, wound infections, and post-farrowing clean-up in sows.',
      dosage: '20 mg/kg BW IM = 1 ml per 10 kg BW, single deep IM dose; repeat after 3–4 days if severe.',
      doses: {
        newborn: '0.5 ml IM once, repeat after 3–4 days if needed.',
        nursery: '0.5–1 ml IM every 3–4 days.',
        weaned: '1–2 ml IM every 3–4 days.',
        grower: '1 ml per 10 kg BW IM every 3–4 days.',
        sow: '15–20 ml IM every 3–4 days.',
        lactating: '15–20 ml IM every 3–4 days.',
        boar: '15–25 ml IM every 3–4 days.',
        piglet: '≈1 ml per 10 kg BW IM.'
      },
      route: 'Deep Intramuscular (neck)', withdrawal: 'Meat 21–28 days',
      price: '₱380–₱750 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['fever', 'cough', 'diarrhea', 'scours', 'wounds', 'foot rot', 'pneumonia', 'labored breathing', 'abortion', 'mastitis', 'pilay', 'lagnat', 'ubo'],
      source: 'Product label · Merck Vet Manual'
    },
    {
      key: 'penstrep', name: 'Penicillin-Streptomycin (Penstrep 20/25)', active: 'Procaine penicillin G 200,000 IU + Dihydrostreptomycin 250 mg/ml',
      aliases: ['penstrep', 'pen-strep', 'pen strep', 'combiotic', 'combopen', 'pen & strep', 'procaine penicillin'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Benzylpenicillin',
      usage: 'Synergistic combination for joint ill (swollen joints), navel infections, erysipelas (diamond skin), septicemia, and infected castration wounds.',
      dosage: '1 ml per 10 kg BW IM once daily for 3–5 consecutive days.',
      doses: {
        newborn: '0.3–0.5 ml IM daily for 3 days.',
        nursery: '0.5–1.5 ml IM daily for 3–5 days.',
        weaned: '1.5–3 ml IM daily for 3–5 days.',
        grower: '1 ml per 10 kg BW IM daily for 3–5 days.',
        sow: '15–20 ml IM daily for 3–5 days.',
        lactating: '15–20 ml IM daily for 3–5 days.',
        boar: '15–25 ml IM daily for 3–5 days.',
        piglet: '≈1 ml per 10 kg BW IM daily.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'Meat 18–30 days',
      price: '₱350–₱680 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['lameness', 'swollen joints', 'joint ill', 'septicemia', 'fever', 'diamond skin', 'erysipelas', 'navel infection', 'wounds', 'castration wound', 'pilay'],
      source: 'Product label · Merck Vet Manual'
    },
    {
      key: 'enrofloxacin', name: 'Enrofloxacin 10% (Baytril® type)', active: 'Enrofloxacin 100 mg/ml',
      aliases: ['baytril', 'enro', 'enroflox', 'enrovet', 'enrocin', 'quinolone'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Enrofloxacin',
      usage: 'Fast-acting fluoroquinolone for severe colibacillosis (E. coli scours), salmonellosis, MMA, and complex pneumonia.',
      dosage: '2.5–5 mg/kg BW SC/IM = 1 ml per 20–40 kg BW once daily for 3 consecutive days.',
      doses: {
        newborn: '0.2–0.3 ml SC daily for 3 days (observe dosage in young piglets).',
        nursery: '0.3–0.5 ml SC daily for 3 days.',
        weaned: '0.5–1 ml SC/IM daily for 3–5 days.',
        grower: '1 ml per 20 kg BW IM daily for 3 days.',
        sow: '7.5–10 ml IM daily for 3 days.',
        lactating: '7.5–10 ml IM daily for 3 days (ideal for severe MMA).',
        boar: '10–12 ml IM daily for 3 days.',
        piglet: '≈0.5 ml per 10 kg BW SC daily.'
      },
      route: 'Subcutaneous or Intramuscular', withdrawal: 'Meat 10 days',
      price: '₱850–₱1,450 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['scours', 'diarrhea', 'e. coli', 'colibacillosis', 'cough', 'pneumonia', 'fever', 'mma', 'pagtatae', 'matinding diarrhea'],
      source: 'Product label · Bayer/Elanco'
    },
    {
      key: 'draxxin', name: 'Tulathromycin 100 mg/ml (Draxxin® type)', active: 'Tulathromycin 100 mg/ml',
      aliases: ['draxxin', 'tulathromycin', 'draxin', 'draxxin 100', 'draxxin injection'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Tulathromycin',
      usage: 'Premium single-dose triamilide for swine respiratory disease complex (Actinobacillus pleuropneumoniae, Pasteurella, Mycoplasma, Bordetella). Sustained therapeutic lung levels up to 14 days.',
      dosage: '2.5 mg/kg BW IM = 1 ml per 40 kg BW, single injection in the neck.',
      doses: {
        newborn: '0.1–0.15 ml IM single dose.',
        nursery: '0.2–0.4 ml IM single dose.',
        weaned: '0.5–1.0 ml IM single dose at weaning/grouping.',
        grower: '1 ml per 40 kg BW IM single dose.',
        sow: '4–5 ml IM single dose.',
        lactating: '4–5 ml IM single dose.',
        boar: '5–6 ml IM single dose.',
        piglet: '1 ml per 40 kg BW IM once.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'Meat 5 days',
      price: '₱2,800–₱4,200 per 50 ml', typeMed: 'Antibiotic',
      symptoms: ['pneumonia', 'severe cough', 'app', 'pleuropneumonia', 'pasteurella', 'mycoplasma', 'thumping', 'labored breathing', 'hirap huminga', 'mabigat na ubo'],
      source: 'Zoetis Draxxin Prescribing Information'
    },
    {
      key: 'tylosin', name: 'Tylosin 200 mg/ml (Tylan® type)', active: 'Tylosin base 200 mg/ml',
      aliases: ['tylan', 'tylovet', 'tylosin 200', 'tylan 200', 'tylan-inj'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Tylosin',
      usage: 'Macrolide for swine dysentery (bloody scours), porcine proliferative enteropathy (ileitis / Lawsonia), and mycoplasma pneumonia.',
      dosage: '10 mg/kg BW IM = 1 ml per 20 kg BW once daily for up to 5 days.',
      doses: {
        newborn: 'Not typical — vet guidance.',
        nursery: '0.25–0.5 ml IM daily for 3 days.',
        weaned: '0.5–1.5 ml IM daily for 3–5 days.',
        grower: '1 ml per 20 kg BW IM daily, up to 5 days.',
        sow: '7.5–10 ml IM daily.',
        lactating: '7.5–10 ml IM daily.',
        boar: '10–12 ml IM daily.',
        piglet: '≈1 ml per 20 kg BW IM daily.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'Meat 14 days',
      price: '₱400–₱820 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['cough', 'pneumonia', 'labored breathing', 'diarrhea', 'ileitis', 'dysentery', 'bloody scours', 'poor growth', 'may dugo ang dumi', 'ubo'],
      source: 'Product label · Elanco'
    },
    {
      key: 'lincomix', name: 'Lincomycin + Spectinomycin (Lincospectin® type)', active: 'Lincomycin HCl 50 mg + Spectinomycin sulfate 100 mg/ml',
      aliases: ['lincospectin', 'lincomix', 'lincomycin', 'spectinomycin', 'lincospec', 'linco-spectin'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Lincomycin',
      usage: 'Dual-action for infectious arthritis (Mycoplasma hyosynoviae), swine dysentery, respiratory pneumonia, and bacterial enteritis in growing pigs.',
      dosage: '1 ml per 10 kg BW IM once daily for 3–5 days.',
      doses: {
        newborn: '0.2–0.4 ml IM daily.',
        nursery: '0.5–1 ml IM daily for 3–5 days.',
        weaned: '1–2 ml IM daily for 3–5 days.',
        grower: '1 ml per 10 kg BW IM daily for 3–5 days.',
        sow: '15–20 ml IM daily for 3–5 days.',
        lactating: '15–20 ml IM daily.',
        boar: '15–25 ml IM daily.',
        piglet: '≈1 ml per 10 kg BW IM.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'Meat 14 days',
      price: '₱650–₱1,150 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['arthritis', 'swollen joints', 'lameness', 'dysentery', 'bloody scours', 'pneumonia', 'mycoplasma', 'pilay', 'namamaga ang tuhod'],
      source: 'Product label · Zoetis'
    },
    {
      key: 'gentamicin', name: 'Gentamicin 40 mg/ml', active: 'Gentamicin sulfate 40 mg/ml',
      aliases: ['genta', 'gentomax', 'garamycin', 'gentamicin 10%'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Gentamicin',
      usage: 'Potent aminoglycoside for acute piglet colibacillosis (E. coli watery scours) and septicemia. Maintain hydration.',
      dosage: '4 mg/kg BW IM once daily for up to 3 days (≈1 ml per 10 kg BW).',
      doses: {
        newborn: '0.2–0.3 ml IM daily for up to 3 days.',
        nursery: '0.3–0.5 ml IM daily for 3 days.',
        weaned: '0.5–1 ml IM daily for 3 days.',
        grower: '1 ml per 10 kg BW IM daily, max 3 days.',
        sow: '12–15 ml IM daily (vet-directed).',
        lactating: '12–15 ml IM daily (vet-directed).',
        boar: '15–20 ml IM daily.',
        piglet: '≈1 ml per 10 kg BW IM daily.'
      },
      route: 'Intramuscular', withdrawal: 'Meat 14 days',
      price: '₱250–₱520 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['scours', 'diarrhea', 'e. coli', 'septicemia', 'weakness', 'fever', 'watery diarrhea', 'tubig ang dumi'],
      source: 'Product label'
    },
    {
      key: 'ceftiofur', name: 'Ceftiofur 50 mg/ml (Naxcel® / Excede® type)', active: 'Ceftiofur hydrochloride 50 mg/ml',
      aliases: ['naxcel', 'excede', 'excenel', 'ceftiofur', 'cef-50'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Ceftiofur',
      usage: '3rd-generation cephalosporin for acute respiratory disease (Actinobacillus, Pasteurella, Streptococcus suis meningitis). Zero milk discard.',
      dosage: '3–5 mg/kg BW IM = 1 ml per 10–16 kg BW once daily for 3 consecutive days.',
      doses: {
        newborn: '0.2–0.3 ml IM daily for 3 days.',
        nursery: '0.3–0.6 ml IM daily for 3 days.',
        weaned: '0.6–1.5 ml IM daily for 3 days.',
        grower: '1 ml per 15 kg BW IM daily for 3 days.',
        sow: '10–15 ml IM daily for 3 days.',
        lactating: '10–15 ml IM daily for 3 days.',
        boar: '12–18 ml IM daily for 3 days.',
        piglet: '≈1 ml per 12 kg BW IM daily.'
      },
      route: 'Intramuscular', withdrawal: 'Meat 2–4 days',
      price: '₱1,300–₱2,200 per 50 ml', typeMed: 'Antibiotic',
      symptoms: ['pneumonia', 'cough', 'labored breathing', 'fever', 'meningitis', 'strep suis', 'paddling', 'depression', 'ubo', 'nanginginig'],
      source: 'Product label · Zoetis'
    },
    {
      key: 'florfenicol', name: 'Florfenicol 300 mg/ml (Nuflor® type)', active: 'Florfenicol 300 mg/ml',
      aliases: ['nuflor', 'florvet', 'florfen', 'florfenicol 30%'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Florfenicol',
      usage: 'Broad spectrum for swine respiratory disease complex (Pasteurella multocida, Actinobacillus pleuropneumoniae, Mycoplasma).',
      dosage: '15 mg/kg BW IM = 1 ml per 20 kg BW, two doses given 48 h apart.',
      doses: {
        newborn: 'Vet-guided only.',
        nursery: '0.25–0.5 ml IM, repeat after 48 h.',
        weaned: '0.5–1.5 ml IM, repeat after 48 h.',
        grower: '1 ml per 20 kg BW IM, repeat after 48 h.',
        sow: '7.5–10 ml IM, repeat after 48 h.',
        lactating: '7.5–10 ml IM, repeat after 48 h.',
        boar: '10–15 ml IM, repeat after 48 h.',
        piglet: '≈1 ml per 20 kg BW IM.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'Meat 16 days',
      price: '₱950–₱1,800 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['pneumonia', 'cough', 'labored breathing', 'fever', 'app', 'respiratory', 'hirap huminga'],
      source: 'Product label · Merck'
    },
    {
      key: 'vetracin-gold', name: 'Vetracin Gold® with Probiotics', active: 'Doxycycline HCl + Tiamulin hydrogen fumarate',
      aliases: ['vetracin', 'vetracin gold', 'vetracin powder', 'doxy tiamulin', 'doxycycline tiamulin'],
      type: 'Antibiotic', form: 'Powder/Sachet', unit: 'sachet', wiki: 'Doxycycline',
      usage: 'Top-selling Philippine water-soluble powder for bacterial pneumonia, CRD, and swine dysentery in growing pigs and weanlings.',
      dosage: '1 sachet (5 g) per 2 gallons (7.5 liters) of drinking water for 5–7 consecutive days.',
      doses: {
        newborn: 'Via medicated drinking water under veterinary guidance.',
        nursery: '1 sachet (5 g) per 7.5 L drinking water for 5 days.',
        weaned: '1 sachet (5 g) per 7.5 L drinking water for 5–7 days.',
        grower: '2 sachets (10 g) per 15 L drinking water for 5–7 days.',
        sow: '10 g per 15 L water for 5 days.',
        lactating: '10 g per 15 L water.',
        boar: '10 g per 15 L water.',
        piglet: '1 sachet per 7.5 L water.'
      },
      route: 'Oral (drinking water)', withdrawal: 'Meat 7–10 days',
      price: '₱35–₱70 per 5g sachet · ₱450 per box', typeMed: 'Antibiotic',
      symptoms: ['cough', 'colds', 'pneumonia', 'swine flu', 'diarrhea', 'dysentery', 'ubo', 'sipon', 'halak', 'matamlay'],
      source: 'Product label · Univet Nutrition and Animal Healthcare Company (UNAHCO)'
    },
    {
      key: 'tiamulin', name: 'Tiamulin 10% (Denagard® type)', active: 'Tiamulin hydrogen fumarate 100 mg/ml',
      aliases: ['denagard', 'tiam', 'tiamulin 10%', 'denagard 10%'],
      type: 'Antibiotic', form: 'Injection (vial)', unit: 'ml', wiki: 'Tiamulin',
      usage: 'For swine dysentery (bloody scours) and ileitis. ⚠ NEVER combine with ionophore feed additives (monensin, salinomycin, narasin) — fatal.',
      dosage: '10–15 mg/kg BW IM = 1–1.5 ml per 10 kg BW once daily for 3–5 days.',
      doses: {
        weaned: '1–1.5 ml per 10 kg BW IM daily for 3–5 days.',
        grower: '1–1.5 ml per 10 kg BW IM daily for 3–5 days.',
        sow: '10–20 ml IM daily for 3–5 days.',
        lactating: '10–20 ml IM daily.',
        boar: '10–20 ml IM daily.',
        piglet: 'Vet-guided only.'
      },
      route: 'Intramuscular', withdrawal: 'Meat 14 days',
      price: '₱600–₱1,250 per 100 ml', typeMed: 'Antibiotic',
      symptoms: ['bloody scours', 'dysentery', 'mucoid diarrhea', 'ileitis', 'growing pig diarrhea', 'weight loss', 'pagtatae na may dugo'],
      source: 'Product label · Elanco'
    },

    /* ─── 2. ANTIPARASITICS, DEWORMERS & COCCIDIOCIDES ──────────────── */
    {
      key: 'ivermectin', name: 'Ivermectin 1% Injectable', active: 'Ivermectin 10 mg/ml',
      aliases: ['ivomec', 'iver', 'noromectin', 'bimectin', 'ivermitol', 'ivermectin 1%', 'galis shot'],
      type: 'Antiparasitic / Dewormer', form: 'Injection (vial)', unit: 'ml', wiki: 'Ivermectin',
      usage: 'Controls internal worms (roundworms, lungworms, kidney worms) and external parasites (sarcoptic mange mites, lice). Core sow pre-farrowing program.',
      dosage: '300 mcg/kg BW SC = 1 ml per 33 kg BW, single subcutaneous dose.',
      doses: {
        newborn: 'Not given to unweaned piglets.',
        nursery: 'Not given to unweaned piglets.',
        weaned: '1 ml per 33 kg BW SC at weaning grouping.',
        grower: '1 ml per 33 kg BW SC; repeat after 18–21 days for mange outbreaks.',
        sow: '5–6.5 ml SC, 1–2 weeks prior to farrowing.',
        lactating: '5–6.5 ml SC.',
        boar: '6–9 ml SC twice yearly.',
        piglet: 'Not given to unweaned piglets.'
      },
      route: 'Subcutaneous (neck fold behind the ear)', withdrawal: 'Meat 28 days',
      price: '₱450–₱950 per 50 ml', typeMed: 'Antiparasitic / Dewormer',
      symptoms: ['mange', 'scratching', 'rubbing', 'rough skin', 'worms', 'weight loss', 'unthrifty', 'hair loss', 'lice', 'galis', 'nangangati', 'bulate', 'nagpupurga'],
      source: 'Product label · Merck Vet Manual'
    },
    {
      key: 'doramectin', name: 'Doramectin 1% (Dectomax® type)', active: 'Doramectin 10 mg/ml',
      aliases: ['dectomax', 'doramec', 'dectomax injectable', 'dora'],
      type: 'Antiparasitic / Dewormer', form: 'Injection (vial)', unit: 'ml', wiki: 'Doramectin',
      usage: 'Long-acting macrocyclic lactone dewormer and mange parasiticide. Extended persistence vs ivermectin.',
      dosage: '300 mcg/kg BW IM = 1 ml per 33 kg BW, single dose.',
      doses: {
        newborn: 'Not given to unweaned piglets.',
        nursery: 'Not given to unweaned piglets.',
        weaned: '1 ml per 33 kg BW IM.',
        grower: '1 ml per 33 kg BW IM.',
        sow: '5–6.5 ml IM, 1–2 weeks pre-farrow.',
        lactating: '5–6.5 ml IM.',
        boar: '6–9 ml IM every 4–6 months.',
        piglet: 'Not given to unweaned piglets.'
      },
      route: 'Intramuscular', withdrawal: 'Meat 28–35 days',
      price: '₱650–₱1,200 per 50 ml', typeMed: 'Antiparasitic / Dewormer',
      symptoms: ['mange', 'scratching', 'worms', 'weight loss', 'unthrifty', 'rough haircoat', 'galis', 'bulate'],
      source: 'Product label · Zoetis'
    },
    {
      key: 'toltrazuril', name: 'Toltrazuril 5% Oral (Baycox® type)', active: 'Toltrazuril 50 mg/ml',
      aliases: ['baycox', 'toltra', 'baycox 5%', 'coccidiosis drench', 'toltrazuril oral'],
      type: 'Antiparasitic / Dewormer', form: 'Oral solution', unit: 'ml', wiki: 'Toltrazuril',
      usage: 'Single-dose prevention and cure of piglet coccidiosis (Cystoisospora suis) — the primary cause of yellow/pasty/gray scours in 7–21 day old piglets.',
      dosage: '20 mg/kg BW PO = 0.4 ml per kg BW, single oral dose at 3–5 days of age.',
      doses: {
        newborn: '0.4 ml per kg PO once at 3–5 days of age (or 1 ml per piglet).',
        nursery: '0.4 ml per kg PO once as soon as coccidial diarrhea appears.',
        weaned: 'Not typical post-weaning.',
        grower: 'Not applicable.', sow: 'Not applicable.', lactating: 'Not applicable.', boar: 'Not applicable.',
        piglet: '0.4 ml per kg PO once.'
      },
      route: 'Oral (direct mouth drench)', withdrawal: 'Meat 70 days',
      price: '₱1,500–₱2,600 per 250 ml', typeMed: 'Antiparasitic / Dewormer',
      symptoms: ['yellow scours', 'pasty scours', 'coccidiosis', 'gray scours', '7-21 day diarrhea', 'poor growth', 'dilaw na pagtatae', 'malapot na dumi'],
      source: 'Product label · Elanco/Bayer'
    },
    {
      key: 'levamisole', name: 'Levamisole 10% Injectable', active: 'Levamisole HCl 100 mg/ml',
      aliases: ['levam', 'wormex', 'ripercol', 'tramisol', 'levasole'],
      type: 'Antiparasitic / Dewormer', form: 'Injection (vial)', unit: 'ml', wiki: 'Levamisole',
      usage: 'Cost-effective dewormer for Ascaris roundworms, nodular worms, and lungworms in growers and breeding stock.',
      dosage: '7.5 mg/kg BW SC/IM ≈ 0.75 ml per 10 kg BW, single dose.',
      doses: {
        weaned: '0.75 ml per 10 kg BW SC, single dose.',
        grower: '0.75 ml per 10 kg BW SC, single dose.',
        sow: '12–15 ml SC, single dose.',
        lactating: '12–15 ml SC, single dose.',
        boar: '15–20 ml SC, single dose.',
        piglet: 'Weaned piglets only; 0.75 ml per 10 kg BW SC.'
      },
      route: 'Subcutaneous or Intramuscular', withdrawal: 'Meat 14 days',
      price: '₱300–₱620 per 100 ml', typeMed: 'Antiparasitic / Dewormer',
      symptoms: ['worms', 'roundworm', 'ascaris', 'weight loss', 'pot-bellied', 'poor growth', 'bulate', 'malaki ang tiyan'],
      source: 'Product label'
    },

    /* ─── 3. VITAMINS, MINERALS & IRON PREPARATIONS ─────────────────── */
    {
      key: 'jectran-iron', name: 'Jectran Premium® Iron + B12 (4-in-1)', active: 'Iron dextran 100 mg + Cyanocobalamin (B12) + Cobalt chloride + Zinc',
      aliases: ['jectran', 'jectran premium', 'jectran iron', 'iron dextran b12', 'iron b12', 'uniferon', 'gleptosil', 'feran'],
      type: 'Vitamin & Mineral', form: 'Injection (vial)', unit: 'ml', wiki: 'Iron supplement',
      usage: 'Prevention and treatment of piglet iron-deficiency anemia, boosting hemoglobin synthesis and early piglet vigor. The Philippine industry standard piglet shot.',
      dosage: '1–2 ml IM per piglet at 3–5 days of age; repeat with 1 ml at 10–14 days if piglets remain pale.',
      doses: {
        newborn: '1–2 ml IM at Day 3–5 of age in the neck or ham. Essential routine injection.',
        nursery: '1 ml IM booster at 10–14 days if pale.',
        weaned: 'Provide oral minerals in creep/starter feed.',
        grower: 'Not applicable.', sow: 'Not applicable.', lactating: 'Not applicable.', boar: 'Not applicable.',
        piglet: '1–2 ml IM at 3–5 days.'
      },
      route: 'Deep Intramuscular (neck or ham)', withdrawal: 'None (mineral supplement)',
      price: '₱280–₱550 per 100 ml', typeMed: 'Vitamin & Mineral',
      symptoms: ['pale', 'anemia', 'weak piglets', 'rough haircoat', 'labored breathing', 'thumps', 'slow growth', 'maputla', 'nanghihina ang biik', 'iron deficiency'],
      source: 'Product label · Univet/UNAHCO'
    },
    {
      key: 'b-complex', name: 'Vitamin B-Complex + Liver Extract (Belamix® type)', active: 'B1 + B2 + B6 + B12 + Nicotinamide + Liver Extract',
      aliases: ['belamix', 'b complex', 'b-complex', 'combivit', 'liver extract', 'vit b complex', 'vitastress-b'],
      type: 'Vitamin & Mineral', form: 'Injection (vial)', unit: 'ml', wiki: 'B vitamins',
      usage: 'Metabolic booster, appetite stimulant, and post-disease recovery tonic for off-feed sows, convalescing piglets, and stressed pigs.',
      dosage: 'Piglets: 1–2 ml IM; Growers: 3–5 ml IM; Sows & Boars: 5–10 ml IM, repeat every 48 h.',
      doses: {
        newborn: '0.5–1 ml IM/SC.',
        nursery: '1–2 ml IM/SC.',
        weaned: '2–3 ml IM/SC.',
        grower: '3–5 ml IM/SC.',
        sow: '5–10 ml IM/SC (ideal for post-farrowing sows off feed).',
        lactating: '5–10 ml IM/SC.',
        boar: '8–10 ml IM/SC.',
        piglet: '1–2 ml IM/SC.'
      },
      route: 'Intramuscular or Subcutaneous', withdrawal: 'None (vitamins)',
      price: '₱220–₱480 per 100 ml', typeMed: 'Vitamin & Mineral',
      symptoms: ['off feed', 'poor appetite', 'weakness', 'stress', 'recovery', 'thin sow', 'post-vaccination', 'ayaw kumain', 'nanghihina', 'walang gana'],
      source: 'Product label · UNAHCO/Belman'
    },
    {
      key: 'vit-min-dex', name: 'Vit-Min-Dex® / Dextrose 50% Energy Booster', active: 'Dextrose 50% + Electrolytes + B-Vitamins + Amino Acids',
      aliases: ['vit-min-dex', 'vitmindex', 'dextrose 50%', 'energy booster', 'dextrose powder', 'oral dextrose'],
      type: 'Supportive / Oral rehydration', form: 'Oral solution', unit: 'ml', wiki: 'Intravenous sugar solution',
      usage: 'Immediate energy source for weak, shivering, runt piglets, hypoglycemic litters, and sows recovering from prolonged farrowing exhaustion.',
      dosage: 'Piglets: 2–5 ml orally via dropper or syringe every 4–6 hours; Sows: 200–500 ml oral drench or drinking water.',
      doses: {
        newborn: '2–3 ml orally via syringe directly into the mouth upon birth for runts and weak piglets.',
        nursery: '5–10 ml orally or add to creep feed.',
        weaned: '10–20 ml orally or in water.',
        grower: 'In drinking water during stress.',
        sow: '50–100 ml drench for exhausted sows after difficult farrowing.',
        lactating: 'Supportive energy during peak lactation.',
        boar: 'In drinking water during intense breeding season.',
        piglet: '2–5 ml orally per head.'
      },
      route: 'Oral (dropper/syringe) or IP (vet)', withdrawal: 'None',
      price: '₱120–₱280 per 500 ml', typeMed: 'Supportive / Oral rehydration',
      symptoms: ['weak piglets', 'shivering', 'hypoglycemia', 'runts', 'exhaustion', 'chilled piglets', 'difficult farrowing', 'nanginginig', 'nanghihina', 'maliit na biik'],
      source: 'Product label'
    },
    {
      key: 'ors', name: 'Oral Rehydration Salts (ORS Electrolyte Pack)', active: 'Sodium chloride + Potassium chloride + Sodium bicarbonate + Glucose',
      aliases: ['ors', 'electrolytes', 'oral rehydration', 'hydrolyte', 'electrovit', 'stress pack'],
      type: 'Supportive / Oral rehydration', form: 'Powder/Sachet', unit: 'sachet', wiki: 'Oral rehydration therapy',
      usage: 'Replaces critical fluids and electrolytes during scouring, heat stress, transport, and weaning shock. Saves scouring piglets from dehydration death.',
      dosage: 'Dissolve 1 sachet (20 g) per 1 liter of clean drinking water; offer ad libitum.',
      doses: {
        newborn: 'Ad libitum in shallow creep pans — essential scour management.',
        nursery: 'Ad libitum for 2–3 days during scouring.',
        weaned: 'Ad libitum during weaning grouping stress.',
        grower: 'In drinking water during hot summer hours.',
        sow: 'Ad libitum for post-farrowing hydration.',
        lactating: 'Ad libitum to stimulate maximum water intake and milk output.',
        boar: 'Ad libitum during hot weather.',
        piglet: 'Ad libitum in shallow creep dishes.'
      },
      route: 'Oral (drinking water)', withdrawal: 'None',
      price: '₱25–₱65 per sachet', typeMed: 'Supportive / Oral rehydration',
      symptoms: ['dehydration', 'scours', 'diarrhea', 'sunken eyes', 'weakness', 'heat stress', 'tuyot', 'nakabagsak', 'pagtatae'],
      source: 'WHO ORS Standard · Product label'
    },

    /* ─── 4. ANTI-INFLAMMATORY, ANALGESIC & ANTIPYRETIC ─────────────── */
    {
      key: 'flunixin', name: 'Flunixin Meglumine 50 mg/ml (Banamine® type)', active: 'Flunixin meglumine 50 mg/ml',
      aliases: ['banamine', 'flunix', 'finadyne', 'flunixin 5%', 'banamine injection'],
      type: 'Anti-inflammatory / NSAID', form: 'Injection (vial)', unit: 'ml', wiki: 'Flunixin',
      usage: 'Potent non-steroidal anti-inflammatory for acute high fever, sow Mastitis-Metritis-Agalactia (MMA) complex, and post-farrowing endotoxemia.',
      dosage: '2.2 mg/kg BW IM = 2 ml per 45 kg BW once daily for up to 3 days.',
      doses: {
        newborn: 'Vet guidance only.',
        nursery: '0.2–0.5 ml IM (vet-guided).',
        weaned: '0.5–1 ml IM daily.',
        grower: '2 ml per 45 kg BW IM daily for up to 3 days.',
        sow: '6.5–9 ml IM daily for 2–3 days (primary MMA treatment).',
        lactating: '6.5–9 ml IM daily for MMA fever and udder pain.',
        boar: '9–10 ml IM daily.',
        piglet: 'Vet-guided only.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'Meat 12–14 days',
      price: '₱900–₱1,650 per 50 ml', typeMed: 'Anti-inflammatory / NSAID',
      symptoms: ['fever', 'mma', 'mastitis', 'no milk', 'pain', 'post-farrowing', 'off feed', 'lagnat', 'namamaga ang suso', 'walang gatas'],
      source: 'Product label · Merck Animal Health'
    },
    {
      key: 'meloxicam', name: 'Meloxicam 2% (Metacam® type)', active: 'Meloxicam 20 mg/ml',
      aliases: ['metacam', 'meloxic', 'meloxivet', 'metacam 20'],
      type: 'Anti-inflammatory / NSAID', form: 'Injection (vial)', unit: 'ml', wiki: 'Meloxicam',
      usage: 'NSAID for locomotor disorders, lameness, post-operative castration pain, and sow farrowing recovery.',
      dosage: '0.4 mg/kg BW IM = 2 ml per 100 kg BW, single injection; repeat after 24 h if required.',
      doses: {
        newborn: '0.1–0.2 ml IM at castration/tail docking.',
        nursery: '0.2–0.3 ml IM.',
        weaned: '0.5 ml IM.',
        grower: '1–2 ml per 50 kg BW IM.',
        sow: '3–4 ml IM single dose for post-farrowing pain and MMA.',
        lactating: '3–4 ml IM single dose.',
        boar: '4–5 ml IM single dose for lameness.',
        piglet: '0.1–0.2 ml IM at castration.'
      },
      route: 'Intramuscular', withdrawal: 'Meat 5 days',
      price: '₱800–₱1,450 per 50 ml', typeMed: 'Anti-inflammatory / NSAID',
      symptoms: ['lameness', 'pain', 'castration', 'mma', 'fever', 'swollen joints', 'pilay', 'kapon', 'namamaga'],
      source: 'Product label · Boehringer Ingelheim'
    },
    {
      key: 'dipyrone', name: 'Dipyrone / Metamizole 500 mg/ml (Novalgin® type)', active: 'Metamizole sodium 500 mg/ml',
      aliases: ['dipiron', 'metamizole', 'novalgin', 'vetalgin', 'dipyrone 50%'],
      type: 'Anti-inflammatory / NSAID', form: 'Injection (vial)', unit: 'ml', wiki: 'Metamizole',
      usage: 'Fast-acting antipyretic for sudden high fevers, colic, and pain while antibiotics take effect.',
      dosage: 'Piglets: 1–2 ml IM; Growers: 3–5 ml IM; Sows/Boars: 10–20 ml IM; repeat after 12 h if fever persists.',
      doses: {
        newborn: '0.3–0.5 ml IM.',
        nursery: '0.5–1 ml IM.',
        weaned: '1–2 ml IM.',
        grower: '3–5 ml IM.',
        sow: '10–15 ml IM.',
        lactating: '10–15 ml IM.',
        boar: '15–20 ml IM.',
        piglet: '1–2 ml IM.'
      },
      route: 'Intramuscular or Subcutaneous', withdrawal: 'Meat 10 days',
      price: '₱250–₱500 per 100 ml', typeMed: 'Anti-inflammatory / NSAID',
      symptoms: ['fever', 'high temperature', 'pain', 'off feed', 'lethargy', 'mataas na lagnat', 'mainit ang katawan'],
      source: 'Product label'
    },

    /* ─── 5. REPRODUCTIVE & HORMONAL THERAPY ────────────────────────── */
    {
      key: 'oxytocin', name: 'Oxytocin 10–20 IU/ml (Pitocin® type)', active: 'Oxytocin 10–20 IU/ml',
      aliases: ['oxytocin', 'pitocin', 'oxy', 'oxytocin 10iu', 'oxytocin 20iu', 'gatas shot'],
      type: 'Hormone', form: 'Injection (vial)', unit: 'ml', wiki: 'Oxytocin',
      usage: 'Stimulates uterine contractions during delayed farrowing (dystocia) and triggers milk let-down in agalactic sows (MMA). ⚠ Never give before cervix is fully dilated or for farrowing induction < 112 days.',
      dosage: 'Milk let-down: 0.5–1.0 ml (10–20 IU) IM. Farrowing aid: 1–2 ml IM.',
      doses: {
        sow: '1–2 ml IM during protracted farrowing after at least 1 piglet is born.',
        lactating: '0.5–1.0 ml IM 15–30 min before nursing for failed milk let-down.',
        boar: 'Not applicable.', piglet: 'Not applicable.', grower: 'Not applicable.',
        newborn: 'Not applicable.', nursery: 'Not applicable.', weaned: 'Not applicable.'
      },
      route: 'Intramuscular or Subcutaneous', withdrawal: 'None',
      price: '₱150–₱420 per 20–50 ml', typeMed: 'Hormone',
      symptoms: ['no milk', 'agalactia', 'mma', 'delayed farrowing', 'poor let-down', 'restlessness after farrowing', 'walang gatas', 'nahihirapang manganak'],
      source: 'Product label · Merck Vet Manual'
    },
    {
      key: 'ppv-combo', name: 'Farrowsure Gold® B (Parvo + Lepto + Erysipelas)', active: 'Inactivated Porcine Parvovirus (PPV) + Erysipelothrix rhusiopathiae + 6 Leptospira strains',
      aliases: ['farrowsure', 'farrowsure gold', 'farrowsure gold b', 'farrow sure', 'parvovirus vaccine', 'ppv vaccine', 'repro vaccine', 'parvo lepto erysipelas'],
      type: 'Vaccine / Biologic', form: 'Injection (vial)', unit: 'dose', wiki: 'Porcine parvovirus',
      usage: 'Core breeding-herd vaccine against SMEDI reproductive failure (Stillbirths, Mummification, Embryonic Death, Infertility) caused by Parvovirus, Erysipelas, and Leptospirosis.',
      dosage: '2 ml IM per head. Gilts: 2 doses 3–5 weeks apart (finish 2–3 weeks before first breeding). Sows: 1 dose 2–3 weeks before breeding. Boars: semi-annual booster.',
      doses: {
        grower: 'Gilts only: 2 ml IM ×2 doses, 3–5 weeks apart before first breeding.',
        sow: '2 ml IM single booster 2–3 weeks before each breeding.',
        boar: '2 ml IM semi-annually (every 6 months).',
        lactating: '2 ml IM at weaning before re-breeding.',
        piglet: 'Not indicated for piglets (breeding-specific vaccine).'
      },
      route: 'Intramuscular (neck)', withdrawal: 'None',
      price: '₱130–₱180 per dose (2 ml)', typeMed: 'Vaccine / Biologic',
      symptoms: ['reproductive failure', 'abortion', 'stillborn', 'mummified', 'repeat breeder', 'small litter', 'low litter size', 'vaccination', 'pre-breeding', 'nakunan', 'mummy', 'paulit-ulit na pagpapakasta'],
      source: 'Zoetis FarrowSure® GOLD B Prescribing Information'
    },
    {
      key: 'pg600', name: 'P.G. 600® (PMSG + hCG Heat Induction)', active: 'Serum gonadotrophin (PMSG 400 IU) + Chorionic gonadotrophin (hCG 200 IU)',
      aliases: ['pg600', 'pg-600', 'p.g. 600', 'heat induction', 'estrus induction', 'pmsg hcg'],
      type: 'Hormone', form: 'Injection (vial)', unit: 'dose', wiki: 'Gonadotropin',
      usage: 'Induces fertile heat (estrus) in prepubertal gilts (≥ 5.5 months, ≥ 85 kg) and in sows with delayed heat return after weaning.',
      dosage: 'Single 5 ml IM dose per head (400 IU PMSG + 200 IU hCG). Estrus follows in 4–7 days.',
      doses: {
        grower: 'Prepubertal gilts: 5 ml IM once → fertile heat in 4–7 days.',
        sow: '5 ml IM once at weaning (or anestrus sows) → heat in 4–7 days.',
        lactating: 'Give at weaning, not during lactation.',
        boar: 'Not applicable.', piglet: 'Not applicable.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'None',
      price: '₱180–₱320 per dose', typeMed: 'Hormone',
      symptoms: ['no heat', 'delayed heat', 'not in heat', 'heat induction', 'breeding schedule', 'hindi naglalandi', 'ayaw maglandi'],
      source: 'Product label · Intervet/MSD'
    },
    {
      key: 'lutalyse', name: 'Lutalyse® / PGF2α (Dinoprost 5 mg/ml)', active: 'Dinoprost tromethamine 5 mg/ml (prostaglandin F2 alpha)',
      aliases: ['lutalyse', 'enzaprost', 'dinoprost', 'pgf2a', 'estrumate', 'farrowing induction', 'prostaglandin'],
      type: 'Hormone', form: 'Injection (vial)', unit: 'ml', wiki: 'Dinoprost',
      usage: 'Farrowing induction (Day ≥ 112–114) for batch farrowing, and estrus synchronization in open sows. ⚠ ABORTIFACIENT — handle with gloves; never give to pregnant sows unless inducing.',
      dosage: '10 mg (2 ml) IM once. Farrowing follows in 24–36 hours.',
      doses: {
        sow: 'Induction: 2 ml (10 mg) IM on gestation day 112–114 → farrowing in 24–36 h. Open sows: 2 ml IM → heat in 3–5 days.',
        lactating: 'Not during lactation.',
        boar: 'Not applicable.', piglet: 'Not applicable.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'Meat 2 days',
      price: '₱120–₱240 per 2 ml dose', typeMed: 'Hormone',
      symptoms: ['farrowing induction', 'overdue', 'no heat', 'silent heat', 'abortion', 'overdue na sow', 'induce farrowing'],
      source: 'Product label · Zoetis Lutalyse'
    },

    /* ─── 6. VACCINES & BIOLOGICS ───────────────────────────────────── */
    {
      key: 'csf-vaccine', name: 'Hog Cholera / CSF Live Vaccine', active: 'Classical Swine Fever Virus (attenuated C-strain / LPC strain)',
      aliases: ['hog cholera vaccine', 'csf vaccine', 'pestivirus vaccine', 'hog cholera shot', 'lpc vaccine'],
      type: 'Vaccine / Biologic', form: 'Injection (vial)', unit: 'dose', wiki: 'Classical swine fever',
      usage: 'Core Philippine herd immunization against Classical Swine Fever (Hog Cholera). Protects against acute fever, skin cyanosis, and mortality.',
      dosage: '1 dose (1 ml reconstituted) IM per animal. Piglets: at 4–5 weeks (weaning). Sows: pre-breeding or pre-farrowing per herd program.',
      doses: {
        weaned: '1 dose IM at 4–5 weeks of age (weaning).',
        grower: 'Booster at 8–10 weeks if in high-challenge zones.',
        sow: '1 dose IM 2–3 weeks before breeding or pre-farrow.',
        boar: '1 dose IM every 6 months.',
        piglet: '1 dose at weaning.'
      },
      route: 'Intramuscular', withdrawal: 'None',
      price: '₱40–₱120 per dose', typeMed: 'Vaccine / Biologic',
      symptoms: ['vaccination', 'hog cholera prevention', 'csf prevention', 'routine immunization', 'bakuna sa baboy'],
      source: 'BAI Philippine Swine Vaccine Program'
    },
    {
      key: 'mycoplasma-vaccine', name: 'Mycoplasma Vaccine (Respisure® / Ingelvac® type)', active: 'Inactivated Mycoplasma hyopneumoniae bacterin',
      aliases: ['enzootic pneumonia vaccine', 'respisure', 'mycoflex', 'porcilis m hyo', 'suvaxyn mh', 'mycoplasma vaccine'],
      type: 'Vaccine / Biologic', form: 'Injection (vial)', unit: 'dose', wiki: 'Mycoplasma hyopneumoniae',
      usage: 'Prevents Enzootic Pneumonia ("nursery cough"). Reduces lung consolidation lesions and dramatically improves Average Daily Gain (ADG).',
      dosage: '1 dose (1–2 ml IM) at 7–21 days of age. Booster after 2–3 weeks per manufacturer label.',
      doses: {
        newborn: 'First dose at 7–14 days of age.',
        nursery: '1 dose IM at 7–21 days.',
        weaned: 'Booster per label at weaning.',
        grower: 'Catch-up dose if missed.',
        sow: 'Herd booster per veterinarian program.',
        boar: 'Annual booster.',
        piglet: '1 dose IM at 7–21 days.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'None',
      price: '₱80–₱180 per dose', typeMed: 'Vaccine / Biologic',
      symptoms: ['cough', 'chronic cough', 'nursery cough', 'enzootic pneumonia prevention', 'vaccination', 'ubo ng biik', 'bakuna sa ubo'],
      source: 'Product label · Zoetis / Boehringer Ingelheim'
    },
    {
      key: 'pcv2-vaccine', name: 'PCV2 Circovirus Vaccine (Circoflex® type)', active: 'Porcine Circovirus Type 2 (PCV2) ORF2 protein antigen',
      aliases: ['circovirus vaccine', 'circoflex', 'porcilis pcv', 'circovac', 'suvaxyn pcv2', 'fostera pcv', 'circogard'],
      type: 'Vaccine / Biologic', form: 'Injection (vial)', unit: 'dose', wiki: 'Porcine circovirus',
      usage: 'Prevents PCV2-associated Postweaning Multisystemic Wasting Syndrome (PMWS), porcine dermatitis and nephropathy syndrome (PDNS), and wasting.',
      dosage: '1 dose (1–2 ml IM) at 3–4 weeks of age (around weaning).',
      doses: {
        nursery: '1 dose IM at 3–4 weeks of age.',
        weaned: '1 dose IM at weaning.',
        grower: 'Catch-up dose if unvaccinated.',
        sow: 'Pre-farrowing booster per program.',
        boar: 'Annual booster.',
        piglet: '1 dose IM at 3–4 weeks.'
      },
      route: 'Intramuscular', withdrawal: 'None',
      price: '₱150–₱300 per dose', typeMed: 'Vaccine / Biologic',
      symptoms: ['wasting', 'poor growth', 'rough haircoat', 'pmws prevention', 'vaccination', 'namamayat na biik', 'circovirus'],
      source: 'Product label · Boehringer Ingelheim'
    },
    {
      key: 'ecoli-vaccine', name: 'E. coli + Clostridium Maternal Scour Vaccine (Litterguard® type)', active: 'Inactivated E. coli K88, K99, 987P, F41 fimbriae + Clostridium perfringens Type C toxoid',
      aliases: ['scour vaccine', 'sow scour vaccine', 'litterguard', 'neocolipor', 'ecolivac', 'suren'],
      type: 'Vaccine / Biologic', form: 'Injection (vial)', unit: 'dose', wiki: 'Escherichia coli',
      usage: 'Administered to the pregnant sow so her colostrum transfers high maternal antibodies to protect newborn piglets against fatal neonatal scours.',
      dosage: '2 ml IM at 5 weeks and 2 weeks prior to farrowing.',
      doses: {
        sow: '2 ml IM at 5 weeks and 2 weeks pre-farrowing.',
        lactating: 'Administered pre-farrowing, not during lactation.',
        piglet: 'Given to the sow to protect the litter via colostrum.',
        boar: 'Not applicable.'
      },
      route: 'Intramuscular (neck)', withdrawal: 'None',
      price: '₱90–₱180 per dose', typeMed: 'Vaccine / Biologic',
      symptoms: ['neonatal scours prevention', 'e. coli prevention', 'yellow scours', 'pre-farrowing vaccine', 'vaccination', 'bakuna sa inahin para sa pagtatae'],
      source: 'Product label · Zoetis'
    },
    {
      key: 'erysipelas-vaccine', name: 'Swine Erysipelas Bacterin (Eryseng® type)', active: 'Inactivated Erysipelothrix rhusiopathiae bacterin',
      aliases: ['erysipelas vaccine', 'eryseng', 'diamond skin vaccine'],
      type: 'Vaccine / Biologic', form: 'Injection (vial)', unit: 'dose', wiki: 'Erysipelas',
      usage: 'Protects breeding herd and growing pigs from acute erysipelas septicemia, diamond-shaped skin necrosis, and chronic arthritis.',
      dosage: '2 ml IM per head; sows boostered 3–4 weeks pre-farrowing; boars every 6 months.',
      doses: {
        weaned: '2 ml IM per vet program.',
        grower: '2 ml IM booster.',
        sow: '2 ml IM 3–4 weeks pre-farrowing.',
        boar: '2 ml IM semi-annually.',
        piglet: 'Given at weaning.'
      },
      route: 'Intramuscular', withdrawal: 'None',
      price: '₱40–₱95 per dose', typeMed: 'Vaccine / Biologic',
      symptoms: ['diamond skin', 'sudden death', 'arthritis prevention', 'vaccination', 'pulang marka sa balat'],
      source: 'Product label · Hipra'
    },

    /* ─── 7. ANTISEPTICS & TOPICAL WOUND CARE ───────────────────────── */
    {
      key: 'povidone-iodine', name: 'Povidone Iodine 10% Solution', active: 'Povidone Iodine 100 mg/ml (1% available iodine)',
      aliases: ['betadine', 'iodine', 'povidone', 'navel dip', 'iodine 10%', 'castration disinfectant'],
      type: 'Antiseptic / Topical', form: 'Topical liquid', unit: 'bottle', wiki: 'Povidone-iodine',
      usage: 'Standard broad-spectrum antiseptic for newborn navel dipping, castration wound antisepsis, tail docking disinfection, and surgical prep.',
      dosage: 'Apply topically undiluted immediately after birth / procedures.',
      doses: {
        newborn: 'Dip newborn navel cord immediately at birth; spray tail dock & ear notch wounds.',
        nursery: 'Apply to castration incisions and scratches.',
        weaned: 'Apply to fight wounds and ear bites.',
        grower: 'Apply to skin lesions.',
        sow: 'Apply to vulva tears or skin abrasions.',
        boar: 'Apply to tusk trim wounds or cuts.',
        piglet: 'Navel cord dip & castration wound antiseptic.'
      },
      route: 'Topical (dip/spray/swab)', withdrawal: 'None',
      price: '₱120–₱280 per 500 ml', typeMed: 'Antiseptic / Topical',
      symptoms: ['wounds', 'navel infection', 'castration', 'tail docking', 'disinfection', 'cuts', 'sugat', 'pusod', 'kapon'],
      source: 'Veterinary Surgical Standard'
    },
    {
      key: 'alushield', name: 'Aluminum Aerosol Spray (AluShield® type)', active: 'Micronized aluminum powder spray',
      aliases: ['alushield', 'aluminum spray', 'silver spray', 'liquid bandage', 'blue spray', 'wound spray'],
      type: 'Antiseptic / Topical', form: 'Aerosol spray', unit: 'can', wiki: 'Wound healing',
      usage: 'Water-resistant aerosol protective barrier for castration wounds, tail-biting lesions, and surgical cuts. Keeps dirt, flies, and moisture out.',
      dosage: 'Spray a thin protective coating over the clean wound from 15–20 cm distance.',
      doses: {
        newborn: 'Spray over tail docking and castration sites.',
        nursery: 'Spray on scratches, abrasions, and ear lesions.',
        weaned: 'Spray on tail-bite wounds.',
        grower: 'Apply to flank and tail bites.',
        sow: 'Apply to shoulder sores or crate rub abrasions.',
        boar: 'Apply to scratches.',
        piglet: 'Spray on surgical wounds.'
      },
      route: 'Topical Aerosol', withdrawal: 'None',
      price: '₱450–₱850 per 300 ml can', typeMed: 'Antiseptic / Topical',
      symptoms: ['wounds', 'castration', 'tail biting', 'cuts', 'scratches', 'flies', 'sugat', 'kagat sa buntot'],
      source: 'Product label · Neogen'
    }
  ];

  /* Pre-generate the search corpus for each entry */
  LIB.forEach(x => {
    x.searchText = [x.name, x.active, (x.aliases || []).join(' '), x.type, x.usage, (x.symptoms || []).join(' ')].join(' ').toLowerCase();
    x.generic = (x.active || x.name).split(/[ 0-9(]/)[0].toLowerCase();
  });

  const norm = s => String(s || '').toLowerCase();

  /* Map the UI selects (Animal type + Piglet age group) onto a dose bucket */
  function ageGroupKey(animal, age) {
    const a = norm(animal), g = norm(age);
    if (a.includes('boar')) return 'boar';
    if (a.includes('lact')) return 'lactating';
    if (a.includes('sow')) return 'sow';
    if (a.includes('grower') || a.includes('finisher')) return 'grower';
    if (a.includes('piglet')) {
      if (g.includes('newborn')) return 'newborn';
      if (g.includes('7') && g.includes('21')) return 'nursery';
      if (g.includes('wean')) return 'weaned';
      if (g.includes('grow')) return 'grower';
      return 'piglet';
    }
    return 'all';
  }

  const ANIMAL_LABELS = {
    newborn: 'Newborn piglets', nursery: 'Piglets 7–21 days', weaned: 'Weaned piglets',
    grower: 'Growers / Finishers', sow: 'Sows (gestating)', lactating: 'Lactating / farrowed sows',
    boar: 'Boars', piglet: 'Piglets (generic)', all: 'General dose'
  };

  const DOSE_ORDER = ['newborn', 'nursery', 'weaned', 'grower', 'sow', 'lactating', 'boar'];

  function doseFor(entry, key) {
    return (entry.doses && (entry.doses[key] || entry.doses.piglet || entry.doses.all)) || entry.dosage || 'See product label / consult licensed veterinarian.';
  }

  /* High-accuracy smart search by name, brand, active ingredient or alias */
  function byName(q) {
    const t = norm(q).trim();
    if (t.length < 2) return [];
    return LIB.map(x => {
      let s = 0;
      const hay = x.searchText, name = norm(x.name), act = norm(x.active);
      if (name === t || act === t) s += 150;
      if ((x.aliases || []).some(a => a === t)) s += 140;
      if (name.includes(t)) s += 90;
      if (act.includes(t)) s += 80;
      if ((x.aliases || []).some(a => a.includes(t))) s += 70;
      if (x.generic && x.generic.length > 2 && new RegExp('\\b' + x.generic + '\\b').test(t)) s += 60;
      
      // Word token matching
      t.split(/[^\w]+/).filter(w => w.length > 2).forEach(w => {
        if (new RegExp('\\b' + w + '\\b').test(hay)) s += 15;
      });
      return { x, s };
    }).filter(r => r.s > 0).sort((a, b) => b.s - a.s).map(r => r.x);
  }

  /* Symptom & clinical sign search */
  function bySymptoms(text, animal, age) {
    const q = norm(text);
    if (q.length < 2) return [];
    const bucket = ageGroupKey(animal, age);
    const scored = LIB.map(x => {
      let s = 0;
      (x.symptoms || []).forEach(ph => {
        if (q.includes(norm(ph))) s += 30;
      });
      q.split(/[^\w]+/).filter(w => w.length > 2).forEach(w => {
        if (norm(x.usage).includes(w)) s += 8;
        if (norm(x.searchText).includes(w)) s += 5;
      });
      if (/vaccin|bakuna|immuniz|prevent/.test(q) && x.type.includes('Vaccine')) s += 20;
      if (/vitamin|mineral|tonic|enerh|pampataba/.test(q) && x.type.includes('Vitamin')) s += 18;
      if (/deworm|purga|worm|parasite|galis|mange/.test(q) && x.type.includes('Antiparasitic')) s += 20;
      return { x, s };
    }).filter(r => r.s > 0).sort((a, b) => b.s - a.s);

    return scored.map(r => ({ entry: r.x, score: r.s, dose: doseFor(r.x, bucket), bucket }))
      .filter(r => !/^not\b/i.test(r.dose)).slice(0, 10);
  }

  /* Clinical disease matcher */
  const DISEASES = [
    { key: 'asf', name: 'African Swine Fever (ASF)', wiki: 'African swine fever virus',
      aliases: ['african swine fever', 'asf', 'sudden death', 'red ears', 'blue ears', 'bleeding skin', 'high fever', 'many pigs dying', 'namamatay', 'pulang tainga'],
      blurb: 'Highly fatal viral disease. Febrile herds crash within days — cyanotic red-purple ears/belly, weakness, bleeding, sudden deaths.',
      signsText: 'Very high fever, pigs huddled & shivering, skin turning dark red–purple on ears/snout/abdomen, bloody diarrhea, multiple sudden mortalities.',
      noCure: true,
      noCureText: 'NO cure, NO effective on-farm treatment. Suspect ASF? Stop syringes immediately, halt pig movements, isolate pen, and REPORT TO BAI / MUNICIPAL AGRICULTURE OFFICE IMMEDIATELY.' },
    { key: 'csf', name: 'Hog Cholera / Classical Swine Fever (CSF)', wiki: 'Classical swine fever',
      aliases: ['hog cholera', 'classical swine fever', 'csf', 'staggering', 'red blotches', 'skin blotches', 'conjunctivitis', 'pes-te'],
      blurb: 'Severe viral fever similar to ASF — skin cyanosis, staggering hindquarters, high mortality; mandatory reportable disease in the Philippines.',
      signsText: 'High fever, red-purple blotches on skin, sticky eye discharge (conjunctivitis), hindquarter staggering, diarrhea, mortality.',
      meds: [ { k: 'csf-vaccine', why: 'Routine prevention — vaccinate piglets at weaning (4–5 weeks)' } ] },
    { key: 'prrs', name: 'PRRS (Porcine Reproductive & Respiratory Syndrome / Blue Ear)', wiki: 'Porcine reproductive and respiratory syndrome virus',
      aliases: ['prrs', 'blue ear', 'abortion', 'abortions', 'weak piglets', 'respiratory reproductive', 'stillborn', 'mummified', 'nakunan'],
      blurb: 'Viral syndrome causing reproductive catastrophic failures in sows and severe respiratory "thumping" pneumonia in piglets.',
      signsText: 'Late-term abortions, mummified litters, weak-born piglets, sows with fever and blue-cyanotic ears, nursery piglets breathing rapidly ("thumping").',
      meds: [ { k: 'draxxin', why: 'Controls secondary bacterial pneumonia (APP/Pasteurella)' }, { k: 'flunixin', why: 'Anti-inflammatory & fever reduction' }, { k: 'b-complex', why: 'Appetite support' }, { k: 'ors', why: 'Hydration support' } ] },
    { key: 'scours-ecoli', name: 'Colibacillosis (Neonatal E. coli Scours)', wiki: 'Escherichia coli',
      aliases: ['scours', 'diarrhea', 'watery', 'piglet diarrhea', 'yellow stool', 'colibacillosis', 'loose stool', 'pagtatae', 'tubig ang dumi'],
      blurb: 'Bacterial diarrhea in piglets under 1–3 weeks old. Dehydration and metabolic acidosis kill piglets rapidly if fluids are not restored.',
      signsText: 'Watery yellowish diarrhea, wet stained tails, sunken dull eyes, severe dehydration, rapid weight loss.',
      meds: [ { k: 'ors', why: 'Rehydration FIRST — offer electrolyte solution continuously' }, { k: 'amoxicillin', why: 'Systemic penicillin antibiotic' }, { k: 'gentamicin', why: 'Oral/injectable for resistant E. coli' }, { k: 'ecoli-vaccine', why: 'Prevention — vaccinate pregnant sow 5 & 2 weeks pre-farrow' } ] },
    { key: 'coccidiosis', name: 'Piglet Coccidiosis (7–14 Day Scours)', wiki: 'Cystoisospora suis',
      aliases: ['coccidiosis', 'coccidia', 'isospora', 'yellow scours', 'pasty diarrhea', '7 day scours', 'malapot na pagtatae'],
      blurb: 'Protozoal parasite infection typical at 7–21 days of age. Produces pasty yellow-gray foul-smelling diarrhea. Antibiotics have ZERO effect.',
      signsText: 'Pasty yellow to grayish diarrhea in nursing piglets 1–3 weeks old, rough greasy haircoat, stunted growth unaffected by antibiotics.',
      meds: [ { k: 'toltrazuril', why: 'The specific coccidiocide — 1 oral dose (0.4 ml/kg) at 3–5 days of age' }, { k: 'ors', why: 'Rehydration support' } ] },
    { key: 'mycoplasma', name: 'Enzootic Pneumonia (Mycoplasma Cough)', wiki: 'Mycoplasma hyopneumoniae',
      aliases: ['mycoplasma', 'enzootic', 'dry cough', 'chronic cough', 'thumping', 'pneumonia', 'ubo', 'halak'],
      blurb: 'Chronic bacterial lung infection causing persistent dry hacking cough and growth retardation in nursery and growing pigs.',
      signsText: 'Dry, non-productive chronic cough triggered by morning exercise or feeding, unthrifty growth, uneven batches.',
      meds: [ { k: 'draxxin', why: 'Single-dose premium sustained cure' }, { k: 'tylosin', why: 'First-line macrolide antibiotic' }, { k: 'vetracin-gold', why: 'Water-soluble mass medication for pens' }, { k: 'mycoplasma-vaccine', why: 'Piglet vaccination at 7–21 days' } ] },
    { key: 'mma', name: 'MMA Complex (Mastitis-Metritis-Agalactia / Sow No Milk)', wiki: 'Mastitis',
      aliases: ['mastitis', 'no milk', 'mma', 'agalactia', 'hot udder', 'swollen udder', 'walang gatas', 'namamaga ang suso'],
      blurb: 'Post-farrowing sow syndrome — hard swollen hot udder, vaginal discharge, fever, complete failure of milk output; piglets starve.',
      signsText: 'Fresh sow refuses feed, temperature >39.5°C, hard hot painful udder sections, piglets crying and fighting for milk with empty stomachs.',
      meds: [ { k: 'oxytocin', why: 'Stimulates immediate milk let-down (0.5–1 ml IM)' }, { k: 'flunixin', why: 'Potent anti-inflammatory to relieve udder swelling and fever' }, { k: 'amoxicillin', why: 'Antibacterial coverage against coliforms and strep' } ] },
    { key: 'mange', name: 'Sarcoptic Mange & Lice (Galis)', wiki: 'Sarcoptes scabiei',
      aliases: ['mange', 'scabies', 'lice', 'itching', 'scratching', 'crusty skin', 'rubbing', 'galis', 'nangangati'],
      blurb: 'Mite infestation causing intense scratching, thick crusts in ear canals, rough skin, and severe feed conversion losses.',
      signsText: 'Frequent rubbing against walls and gates, crusty brown lesions inside the ear flap, hyperkeratosis (thick skin) on flanks.',
      meds: [ { k: 'ivermectin', why: 'Injectable 1% SC, repeat in 18–21 days' }, { k: 'doramectin', why: 'Single-dose long-acting alternative' } ] }
  ];

  function matchDiseases(text) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    if (t.length < 3) return [];
    const wordHit = a => new RegExp('[^a-z0-9]' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^a-z0-9]').test(t);
    return DISEASES
      .map(d => ({ d, hits: (d.aliases || []).filter(a => a.length > 2 && (t.includes(a) || wordHit(a))).length }))
      .filter(x => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 4)
      .map(x => x.d);
  }

  window.VetLib = { LIB, byName, bySymptoms, doseFor, ageGroupKey, ANIMAL_LABELS, DOSE_ORDER, DISEASES, matchDiseases };
})();
