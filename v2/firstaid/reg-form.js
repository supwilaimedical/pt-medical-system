// regForm — shared registry form module for firstaid admin + staff
// Extracted VERBATIM from v2/firstaid/index.html (CC/Problem/Treatment data + reg_* functions).
// Globals replaced with ctx callback: fa_currentEventConfig, fa_currentEventType,
// fa_currentViewedEventId, fa_allEvents, fa_currentRegistryRecords, getUserName().
// Hooks: onCanEdit(record) -> bool, onAfterSave(regId), locationLock (force + disable location dropdown).
(function() {
    // --- CC & Problem Dropdown Data (Hardcoded — IMMDA + Mass Gathering Medical) ---
    var REG_CC_MED = [
        'Muscle cramp/ตะคริว',
        'Musculoskeletal (lower limb)/ปวดขาส่วนล่าง',
        'Musculoskeletal (upper limb)/ปวดแขนส่วนบน',
        'Skin (blister/chafing)/ตุ่มน้ำ เสียดสี',
        'Skin (laceration/abrasion)/แผลฉีก ถลอก',
        'Collapse (pre-finish)/หมดสติก่อนเข้าเส้นชัย',
        'Collapse (post-finish)/หมดสติหลังเข้าเส้นชัย',
        'Chest pain/เจ็บหน้าอก',
        'Dyspnea/หายใจลำบาก',
        'Nausea & Vomiting/คลื่นไส้ อาเจียน',
        'Headache/ปวดศีรษะ',
        'Dizziness & Syncope/เวียนศีรษะ หน้ามืด',
        'Abdominal pain/ปวดท้อง',
        'Heat-related/อาการจากความร้อน',
        'Hypothermia/อาการจากความเย็น',
        'Allergic reaction/อาการแพ้',
        'Eye problem/ปัญหาทางตา',
        'Insect bite & sting/แมลงกัดต่อย',
        'Dehydration/ขาดน้ำ',
        'Seizure/ชัก',
        'Cardiac arrest/หัวใจหยุดเต้น',
        'Anxiety & Panic attack/วิตกกังวล แพนิค',
        'Other (ระบุ)'
    ];

    var REG_CC_TRAUMA = [
        'Fall/ล้ม สะดุด',
        'Collision/ชนกัน',
        'Abrasion & Road rash/ถลอก',
        'Laceration/แผลฉีก',
        'Contusion/ฟกช้ำ',
        'Sprain & Strain/เคล็ด กล้ามเนื้อตึง',
        'Dislocation/ข้อเคลื่อน',
        'Suspected fracture/สงสัยกระดูกหัก',
        'Head injury/บาดเจ็บศีรษะ',
        'Burn and Scalds/แผลไฟไหม้น้ำร้อนลวก',
        'Other (ระบุ)'
    ];

    var REG_PROBLEMS = [
        'EAMC — ตะคริวจากออกกำลังกาย',
        'EAC — หมดแรง/ล้มขณะวิ่ง',
        'EAH — ภาวะโซเดียมต่ำ',
        'Exertional Heat Stroke — ลมแดด/ฮีทสโตรก',
        'Heat Exhaustion — เพลียแดด',
        'Hypothermia — อุณหภูมิร่างกายต่ำ',
        'Trauma/Musculoskeletal — บาดเจ็บกล้ามเนื้อ/กระดูก',
        'Skin/Soft tissue — ผิวหนัง/เนื้อเยื่ออ่อน',
        'Respiratory Distress — หายใจลำบาก',
        'Emergency Cardiac Care — หัวใจฉุกเฉิน',
        'Cardiac Arrest — หัวใจหยุดเต้น',
        'Allergy/Anaphylaxis — แพ้/แอนาฟิแล็กซิส',
        'Hydration Guidance — แนะนำการดื่มน้ำ',
        'GI Distress — ระบบทางเดินอาหาร',
        'Neurological — ระบบประสาท',
        'Syncope/Collapse — หมดสติ/เป็นลม',
        'Intoxication — มึนเมา/สารเสพติด',
        'Anxiety/Panic Attack — วิตกกังวล/แพนิค',
        'Crowd Crush Injury — บาดเจ็บจากฝูงชนเบียด',
        'Seizure — ชัก',
        'Assault Injury — บาดเจ็บจากทำร้ายร่างกาย',
        'Wound/Laceration — แผล/ฉีกขาด',
        'Hypo/Hyperglycemia — น้ำตาลในเลือดผิดปกติ',
        'Fever/Infection — ไข้/ติดเชื้อ',
        'Other (ระบุ)'
    ];

    var REG_TREATMENTS = [
        { group: 'ทั่วไป', color: '#198754', items: ['แอมโมเนีย', 'พลาสเตอร์ยา', 'ยานวด/สเปรย์', 'Cold pack'] },
        { group: 'Trauma/แผล', color: '#dc3545', items: ['ทำแผล/Wound dressing', 'ห้ามเลือด/Pressure', 'Splint/ดาม', 'Eye wash', 'Stretching/ยืดกล้ามเนื้อ'] },
        { group: 'Medical', color: '#0d6efd', items: ['Oxygen/O2', 'Nebulization', 'IV Fluid', 'CPR/AED'] },
        { group: 'Environment', color: '#f59e0b', items: ['Hot pack', 'Cool down', 'Keep warm'] }
    ];

    // Module state — set via init()
    var _supabase = null;
    var _ctx = null;       // function returning { eventId, eventConfig, eventType, recordedBy, locationLock, allEvents, registryRecords }
    var _hooks = {};       // { onAfterSave, onCanEdit }
    var fa_registryModal = null;

    function _getCtx() { return (typeof _ctx === 'function') ? (_ctx() || {}) : {}; }
    function _getEventConfig() { return _getCtx().eventConfig || null; }
    function _getRegistryRecords() { return _getCtx().registryRecords || (typeof fa_currentRegistryRecords !== 'undefined' ? fa_currentRegistryRecords : []) || []; }
    function _getRecordedBy() {
        var c = _getCtx();
        if (c.recordedBy) return c.recordedBy;
        if (typeof getUserName === 'function') return getUserName();
        return 'Unknown';
    }

    // Build treatment ghost buttons from grouped array
    function reg_buildTreatmentGrid() {
        var grid = document.getElementById('reg-treatment-grid');
        if (!grid) return;
        grid.innerHTML = '';
        REG_TREATMENTS.forEach(function(g) {
            // Group label
            var label = document.createElement('div');
            label.className = 'w-100 mt-1 mb-1';
            label.innerHTML = '<span class="badge rounded-pill" style="background:' + g.color + '; font-size:0.65rem; font-weight:600; letter-spacing:0.5px;">' + g.group + '</span>';
            grid.appendChild(label);
            // Buttons
            g.items.forEach(function(t) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm reg-tx-btn';
                btn.setAttribute('data-value', t);
                btn.textContent = t;
                btn.onclick = function() { this.classList.toggle('active'); };
                grid.appendChild(btn);
            });
        });
    }

    // Helper: get flat list of all treatment values
    function reg_getAllTreatmentValues() {
        var all = [];
        REG_TREATMENTS.forEach(function(g) { all = all.concat(g.items); });
        return all;
    }

    // --- Triage toggle ---
    function reg_setTriage(val) {
        document.getElementById('reg-triage').value = val;
        document.querySelectorAll('.reg-triage-btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-value') === val);
        });
    }
    // Legacy compat (called from some places)
    function reg_updateTriageColor() {}

    // --- Gender toggle ---
    function reg_setGender(val) {
        document.getElementById('reg-gender').value = val;
        document.querySelectorAll('.reg-gender-btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-value') === val);
        });
    }

    // --- Etiology Toggle ---
    function reg_toggleEtiology(type) {
        var btnMed = document.getElementById('reg-etiology-med');
        var btnTrauma = document.getElementById('reg-etiology-trauma');
        if (type === 'Med') {
            btnMed.classList.add('btn-primary'); btnMed.classList.remove('btn-outline-primary');
            btnTrauma.classList.add('btn-outline-danger'); btnTrauma.classList.remove('btn-danger');
        } else {
            btnTrauma.classList.add('btn-danger'); btnTrauma.classList.remove('btn-outline-danger');
            btnMed.classList.add('btn-outline-primary'); btnMed.classList.remove('btn-primary');
        }
        document.getElementById('reg-etiology-value').value = type;
        // Repopulate CC dropdown
        var ccSelect = document.getElementById('reg-cc');
        var ccList = type === 'Med' ? REG_CC_MED : REG_CC_TRAUMA;
        ccSelect.innerHTML = '<option value="">-- เลือก CC --</option>';
        ccList.forEach(function(item) {
            ccSelect.innerHTML += '<option value="' + item + '">' + item + '</option>';
        });
        // Show/hide CC Other
        document.getElementById('reg-cc-other-div').classList.add('d-none');
        document.getElementById('reg-cc-other').value = '';
    }

    function reg_onCCChange() {
        var val = document.getElementById('reg-cc').value;
        if (val && val.indexOf('Other') > -1) {
            document.getElementById('reg-cc-other-div').classList.remove('d-none');
        } else {
            document.getElementById('reg-cc-other-div').classList.add('d-none');
            document.getElementById('reg-cc-other').value = '';
        }
    }

    function reg_onProblemChange() {
        var val = document.getElementById('reg-problem').value;
        if (val && val.indexOf('Other') > -1) {
            document.getElementById('reg-problem-other-div').classList.remove('d-none');
        } else {
            document.getElementById('reg-problem-other-div').classList.add('d-none');
            document.getElementById('reg-problem-other').value = '';
        }
    }

    // --- Populate Problem List based on event config ---
    function reg_populateProblemList() {
        var sel = document.getElementById('reg-problem');
        sel.innerHTML = '<option value="">-- เลือก Problem --</option>';
        REG_PROBLEMS.forEach(function(item) {
            sel.innerHTML += '<option value="' + item + '">' + item + '</option>';
        });
    }

    // --- Populate dynamic dropdowns from event config ---
    function reg_populateEventConfigDropdowns() {
        var cfg = _getEventConfig() || {};
        // Category dropdown
        var catDiv = document.getElementById('reg-category-div');
        var catSel = document.getElementById('reg-category');
        if (cfg.categories && cfg.categories.length > 0) {
            catDiv.classList.remove('d-none');
            catSel.innerHTML = '<option value="">-- เลือก --</option>';
            cfg.categories.forEach(function(c) { catSel.innerHTML += '<option value="' + c + '">' + c + '</option>'; });
        } else {
            catDiv.classList.add('d-none');
        }
        // Location Tx dropdown
        var locSel = document.getElementById('reg-location-tx');
        locSel.innerHTML = '<option value="">-- เลือก --</option>';
        if (cfg.locations && cfg.locations.length > 0) {
            cfg.locations.forEach(function(l) { locSel.innerHTML += '<option value="' + l + '">' + l + '</option>'; });
        }
        // Name placeholder based on idLabel
        var nameInput = document.getElementById('reg-name');
        if (cfg.idLabel) {
            nameInput.placeholder = 'ชื่อ-สกุล (' + cfg.idLabel + ')';
        } else {
            nameInput.placeholder = 'ชื่อ-สกุล';
        }
    }

    // --- Result Toggle ---
    function reg_toggleResult(type) {
        var btnDC = document.getElementById('reg-result-dc');
        var btnTransfer = document.getElementById('reg-result-transfer');
        var divDC = document.getElementById('reg-result-dc-sub');
        var divTransfer = document.getElementById('reg-result-transfer-sub');
        if (type === 'dc') {
            btnDC.classList.add('btn-success'); btnDC.classList.remove('btn-outline-success');
            btnTransfer.classList.add('btn-outline-warning'); btnTransfer.classList.remove('btn-warning');
            divDC.classList.remove('d-none');
            divTransfer.classList.add('d-none');
        } else {
            btnTransfer.classList.add('btn-warning'); btnTransfer.classList.remove('btn-outline-warning');
            btnDC.classList.add('btn-outline-success'); btnDC.classList.remove('btn-success');
            divTransfer.classList.remove('d-none');
            divDC.classList.add('d-none');
        }
        document.getElementById('reg-result-type').value = type;
    }

    // --- Allergy Toggle ---
    function reg_toggleAllergy() {
        var sel = document.getElementById('reg-allergy');
        var div = document.getElementById('reg-allergy-detail-div');
        if (sel.value === 'มี') { div.classList.remove('d-none'); }
        else { div.classList.add('d-none'); document.getElementById('reg-allergy-detail').value = ''; }
    }

    // --- Vitals Toggle ---
    function reg_toggleVitals() {
        var section = document.getElementById('reg-vitals-body');
        var icon = document.getElementById('reg-vitals-toggle-icon');
        if (section.classList.contains('d-none')) {
            section.classList.remove('d-none');
            icon.className = 'bi bi-chevron-up';
        } else {
            section.classList.add('d-none');
            icon.className = 'bi bi-chevron-down';
        }
    }

    // --- GPS ---
    function reg_getLocation() {
        if (!navigator.geolocation) {
            Swal.fire('GPS ไม่พร้อมใช้งาน', 'เบราว์เซอร์ไม่รองรับ GPS', 'warning');
            return;
        }
        document.getElementById('reg-gps').value = 'กำลังค้นหาพิกัด...';
        navigator.geolocation.getCurrentPosition(
            function(pos) { document.getElementById('reg-gps').value = pos.coords.latitude + ', ' + pos.coords.longitude; },
            function(err) {
                document.getElementById('reg-gps').value = '';
                Swal.fire('GPS Error', 'ไม่สามารถดึงพิกัดได้', 'warning');
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }

    // =============================================
    // Open Registry Form (New or Edit)
    // =============================================
    function reg_openForm(eventId, regId) {
        // Edit-permission gate (hook): if onCanEdit returns false, alert + bail
        if (regId && typeof _hooks.onCanEdit === 'function') {
            var rec0 = (_getRegistryRecords() || []).find(function(x) { return x.id === regId; });
            if (rec0 && _hooks.onCanEdit(rec0) === false) {
                Swal.fire({ icon: 'info', title: 'ไม่สามารถแก้ไขได้', text: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้', timer: 2000, showConfirmButton: false });
                return;
            }
        }

        var form = document.getElementById('reg-form');
        form.reset();
        document.getElementById('reg-form-event-id').value = eventId;
        document.getElementById('reg-form-reg-id').value = '';
        document.getElementById('reg-form-existing-image').value = '';

        // Reset states
        reg_toggleEtiology('Med');
        reg_populateProblemList();
        reg_populateEventConfigDropdowns();
        reg_toggleResult('dc');
        document.getElementById('reg-allergy').value = 'ไม่มี';
        reg_toggleAllergy();
        document.getElementById('reg-vitals-body').classList.add('d-none');
        document.getElementById('reg-vitals-toggle-icon').className = 'bi bi-chevron-down';
        document.getElementById('reg-cc-other-div').classList.add('d-none');
        document.getElementById('reg-problem-other-div').classList.add('d-none');
        reg_setTriage('A');
        reg_setGender('');

        // Set default time in
        var now = new Date();
        document.getElementById('reg-time-in').value = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

        // Reset treatment buttons
        reg_buildTreatmentGrid();
        document.querySelectorAll('.reg-tx-btn[data-value="จ่ายยา"]').forEach(function(b) { b.classList.remove('active'); });
        document.getElementById('reg-treatment-med-detail').value = '';
        document.getElementById('reg-treatment-med-detail').classList.add('d-none');
        document.getElementById('reg-treatment-other-text').value = '';

        if (regId) {
            document.getElementById('reg-form-reg-id').value = regId;
            document.getElementById('reg-modal-title').innerHTML = '<i class="bi bi-pencil-square text-warning me-2"></i> แก้ไข Registry';

            // Find record in registry records (ctx.registryRecords or legacy global)
            var rec = (_getRegistryRecords() || []).find(function(x) { return x.id === regId; });
            if (rec) {
                reg_setTriage(rec.triage || 'A');
                reg_setGender(rec.gender || '');
                document.getElementById('reg-age').value = rec.age || '';
                document.getElementById('reg-name').value = rec.name || '';
                document.getElementById('reg-phone').value = rec.phone ? rec.phone.replace(/^'/, '') : '';
                document.getElementById('reg-category').value = rec.category || '';
                document.getElementById('reg-location-tx').value = rec.locationTx || '';
                document.getElementById('reg-time-in').value = rec.timeIn || '';
                document.getElementById('reg-time-out').value = rec.timeOut || '';
                document.getElementById('reg-form-existing-image').value = rec.image || '';

                // Etiology & CC
                if (rec.etiology) reg_toggleEtiology(rec.etiology);
                if (rec.cc) {
                    document.getElementById('reg-cc').value = rec.cc;
                    reg_onCCChange();
                    if (rec.ccOther) document.getElementById('reg-cc-other').value = rec.ccOther;
                }
                // Problem
                if (rec.problem) {
                    document.getElementById('reg-problem').value = rec.problem;
                    reg_onProblemChange();
                    if (rec.problemOther) document.getElementById('reg-problem-other').value = rec.problemOther;
                }
                // Treatment
                var treatments = rec.treatment ? rec.treatment.split(', ') : [];
                treatments.forEach(function(t) {
                    if (t.indexOf('จ่ายยา') > -1) {
                        var medBtn = document.querySelector('.reg-tx-btn[data-value="จ่ายยา"]');
                        if (medBtn) medBtn.classList.add('active');
                        var match = t.match(/\((.*?)\)/);
                        if (match) {
                            document.getElementById('reg-treatment-med-detail').value = match[1];
                            document.getElementById('reg-treatment-med-detail').classList.remove('d-none');
                        }
                    } else {
                        var btn = document.querySelector('#reg-treatment-grid .reg-tx-btn[data-value="' + t + '"]');
                        if (btn) btn.classList.add('active');
                        else if (t) document.getElementById('reg-treatment-other-text').value = (document.getElementById('reg-treatment-other-text').value ? document.getElementById('reg-treatment-other-text').value + ', ' : '') + t;
                    }
                });
                // Allergy
                if (rec.allergy && rec.allergy.indexOf('มี') > -1) {
                    document.getElementById('reg-allergy').value = 'มี';
                    document.getElementById('reg-allergy-detail').value = rec.allergy.replace('มี', '').replace(/[()]/g, '').trim();
                }
                reg_toggleAllergy();
                // Vitals
                if (rec.vitals && Object.keys(rec.vitals).length > 0) {
                    var v = rec.vitals;
                    if (v.bp || v.hr || v.rr || v.spo2 || v.temp || v.gcs || v.glucose || v.pain) {
                        document.getElementById('reg-vitals-body').classList.remove('d-none');
                        document.getElementById('reg-vitals-toggle-icon').className = 'bi bi-chevron-up';
                    }
                    document.getElementById('reg-v-bp').value = v.bp || '';
                    document.getElementById('reg-v-hr').value = v.hr || '';
                    document.getElementById('reg-v-rr').value = v.rr || '';
                    document.getElementById('reg-v-spo2').value = v.spo2 || '';
                    document.getElementById('reg-v-temp').value = v.temp || '';
                    document.getElementById('reg-v-gcs').value = v.gcs || '';
                    document.getElementById('reg-v-glucose').value = v.glucose || '';
                    document.getElementById('reg-v-pain').value = v.pain || '';
                }
                // Result
                if (rec.result) {
                    if (rec.result.indexOf('transfer') === 0) {
                        reg_toggleResult('transfer');
                        var parts = rec.result.split(':');
                        if (parts[1] === 'self') document.getElementById('reg-transfer-method').value = 'self';
                        else document.getElementById('reg-transfer-method').value = 'team';
                        document.getElementById('reg-transfer-hospital').value = parts.slice(2).join(':') || '';
                    } else {
                        reg_toggleResult('dc');
                        var dcParts = rec.result.split(':');
                        document.getElementById('reg-dc-sub').value = dcParts[1] || 'finished';
                    }
                }
                // Note
                document.getElementById('reg-note').value = rec.note || '';
                document.getElementById('reg-gps').value = rec.gps || '';
            }
        } else {
            document.getElementById('reg-modal-title').innerHTML = '<i class="bi bi-clipboard2-pulse text-success me-2"></i> บันทึก Medical Registry';
        }

        // Apply locationLock (after dropdown population + after edit-restore)
        var lock = _getCtx().locationLock;
        var locEl = document.getElementById('reg-location-tx');
        if (lock && locEl) {
            // Ensure the option exists (in case event config doesn't include it)
            var hasOpt = false;
            for (var i = 0; i < locEl.options.length; i++) {
                if (locEl.options[i].value === lock) { hasOpt = true; break; }
            }
            if (!hasOpt) {
                var opt = document.createElement('option');
                opt.value = lock;
                opt.textContent = lock;
                locEl.appendChild(opt);
            }
            locEl.value = lock;
            locEl.disabled = true;
        } else if (locEl) {
            locEl.disabled = false;
        }

        if (!fa_registryModal) fa_registryModal = new bootstrap.Modal(document.getElementById('faRegistryModal'));
        fa_registryModal.show();
    }

    // =============================================
    // Submit Registry Form
    // =============================================
    async function reg_submitForm() {
        var form = document.getElementById('reg-form');
        if (!form.checkValidity()) { form.reportValidity(); return; }

        // Manual validation for hidden-input toggle groups (checkValidity skips type=hidden)
        var genderVal = (document.getElementById('reg-gender').value || '').trim();
        if (!genderVal) {
            var tg = document.getElementById('reg-gender-toggle');
            if (tg) {
                tg.scrollIntoView({ behavior:'smooth', block:'center' });
                tg.style.transition = 'box-shadow 0.2s';
                tg.style.boxShadow = '0 0 0 3px rgba(220,53,69,0.35)';
                setTimeout(function(){ tg.style.boxShadow = ''; }, 1500);
            }
            Swal.fire({ icon:'warning', title:'กรุณาเลือกเพศ', timer:1500, showConfirmButton:false });
            return;
        }

        Swal.fire({ title: 'กำลังบันทึก...', didOpen: function() { Swal.showLoading(); } });

        // Collect treatments from ghost buttons
        var treatments = [];
        document.querySelectorAll('#reg-treatment-grid .reg-tx-btn.active').forEach(function(btn) {
            treatments.push(btn.getAttribute('data-value'));
        });
        // Check จ่ายยา button
        var medBtn = document.querySelector('.reg-tx-btn[data-value="จ่ายยา"]');
        if (medBtn && medBtn.classList.contains('active')) {
            var detail = document.getElementById('reg-treatment-med-detail').value.trim();
            treatments.push(detail ? 'จ่ายยา (' + detail + ')' : 'จ่ายยา');
        }
        var otherTrt = document.getElementById('reg-treatment-other-text').value.trim();
        if (otherTrt) treatments.push(otherTrt);

        // Phone
        var phoneVal = document.getElementById('reg-phone').value;
        if (phoneVal && phoneVal.charAt(0) !== "'") phoneVal = "'" + phoneVal;

        // Allergy
        var allergy = document.getElementById('reg-allergy').value;
        if (allergy === 'มี') {
            var detail = document.getElementById('reg-allergy-detail').value.trim();
            allergy = detail ? 'มี (' + detail + ')' : 'มี';
        }

        // Vitals — only include fields that are actually filled, so admin's reports
        // don't show empty {bp:'', hr:'', ...} for every record. NULL if nothing filled.
        var vitalsRaw = {
            bp:      document.getElementById('reg-v-bp').value.trim(),
            hr:      document.getElementById('reg-v-hr').value.trim(),
            rr:      document.getElementById('reg-v-rr').value.trim(),
            spo2:    document.getElementById('reg-v-spo2').value.trim(),
            temp:    document.getElementById('reg-v-temp').value.trim(),
            gcs:     document.getElementById('reg-v-gcs').value.trim(),
            glucose: document.getElementById('reg-v-glucose').value.trim(),
            pain:    document.getElementById('reg-v-pain').value.trim()
        };
        var vitals = {};
        Object.keys(vitalsRaw).forEach(function(k){
            if (vitalsRaw[k]) vitals[k] = vitalsRaw[k];
        });
        if (Object.keys(vitals).length === 0) vitals = null;

        // Result
        var resultType = document.getElementById('reg-result-type').value;
        var resultStr = '';
        if (resultType === 'dc') {
            resultStr = 'dc:' + (document.getElementById('reg-dc-sub').value || 'finished');
        } else {
            var method = document.getElementById('reg-transfer-method').value || 'team';
            var hospital = document.getElementById('reg-transfer-hospital').value.trim() || '';
            resultStr = 'transfer:' + method + ':' + hospital;
        }

        var imageFile = document.getElementById('reg-image').files[0];
        var treatmentStr = treatments.join(', ');

        try {
            var imageUrl = document.getElementById('reg-form-existing-image').value || '';
            if (imageFile) {
                imageUrl = await uploadToCloudinary(imageFile, 'firstaid-registry');
            }

            var regId = document.getElementById('reg-form-reg-id').value;
            var recordData = {
                event_id: document.getElementById('reg-form-event-id').value,
                triage: document.getElementById('reg-triage').value,
                gender: document.getElementById('reg-gender').value,
                age: document.getElementById('reg-age').value ? parseInt(document.getElementById('reg-age').value) : null,
                name: document.getElementById('reg-name').value,
                phone: phoneVal,
                category: document.getElementById('reg-category').value,
                location_tx: document.getElementById('reg-location-tx').value,
                time_in: document.getElementById('reg-time-in').value,
                time_out: document.getElementById('reg-time-out').value,
                etiology: document.getElementById('reg-etiology-value').value,
                cc: document.getElementById('reg-cc').value,
                cc_other: document.getElementById('reg-cc-other').value,
                problem: document.getElementById('reg-problem').value,
                problem_other: document.getElementById('reg-problem-other').value,
                treatment: treatmentStr,
                allergy: allergy,
                vitals_json: vitals,
                result: resultStr,
                note: document.getElementById('reg-note').value,
                image_url: imageUrl,
                gps: document.getElementById('reg-gps').value,
                recorded_by: _getRecordedBy() || 'Unknown'
            };

            var savedRegId = regId;
            if (regId) {
                var { error } = await _supabase.from('fa_registry').update(recordData).eq('reg_id', regId);
                if (error) throw error;
            } else {
                recordData.reg_id = 'R-' + new Date().getTime();
                savedRegId = recordData.reg_id;
                var { error } = await _supabase.from('fa_registry').insert(recordData);
                if (error) throw error;
            }

            Swal.close();
            if (fa_registryModal) fa_registryModal.hide();

            // Hook: onAfterSave (replaces direct fa_refreshPatientList() call)
            if (typeof _hooks.onAfterSave === 'function') {
                try { _hooks.onAfterSave(savedRegId); } catch(e) { console.error('onAfterSave hook error:', e); }
            } else if (typeof fa_refreshPatientList === 'function') {
                // Fallback for admin (legacy global)
                fa_refreshPatientList();
            }
        } catch(err) {
            Swal.fire('Error', 'เกิดข้อผิดพลาด: ' + (err.message || err), 'error');
        }
    }

    // Toggle medication detail input
    function reg_toggleMedDetail() {
        var btn = document.querySelector('.reg-tx-btn[data-value="จ่ายยา"]');
        var input = document.getElementById('reg-treatment-med-detail');
        if (btn && btn.classList.contains('active')) { input.classList.remove('d-none'); }
        else { input.classList.add('d-none'); input.value = ''; }
    }

    // ============================================================
    // Public API
    // ============================================================
    window.regForm = {
        init: function(opts) {
            opts = opts || {};
            _supabase = opts.supabase || null;
            _ctx = opts.ctx || function() { return {}; };
            _hooks = opts.hooks || {};
        },
        open: function(regId) {
            var ctx = _getCtx();
            reg_openForm(ctx.eventId, regId);
        },
        REG_TREATMENTS: REG_TREATMENTS,
        REG_CC_MED: REG_CC_MED,
        REG_CC_TRAUMA: REG_CC_TRAUMA,
        REG_PROBLEMS: REG_PROBLEMS,
        getAllTreatmentValues: reg_getAllTreatmentValues
    };

    // Also expose individual functions globally (so existing inline onclick="reg_setTriage(...)" still works)
    window.reg_setTriage = reg_setTriage;
    window.reg_setGender = reg_setGender;
    window.reg_toggleEtiology = reg_toggleEtiology;
    window.reg_onCCChange = reg_onCCChange;
    window.reg_onProblemChange = reg_onProblemChange;
    window.reg_toggleResult = reg_toggleResult;
    window.reg_toggleAllergy = reg_toggleAllergy;
    window.reg_toggleVitals = reg_toggleVitals;
    window.reg_getLocation = reg_getLocation;
    window.reg_openForm = reg_openForm;       // legacy: callers pass (eventId, regId)
    window.reg_submitForm = reg_submitForm;
    window.reg_toggleMedDetail = reg_toggleMedDetail;
    window.reg_buildTreatmentGrid = reg_buildTreatmentGrid;
    window.reg_populateProblemList = reg_populateProblemList;
    window.reg_populateEventConfigDropdowns = reg_populateEventConfigDropdowns;
    window.reg_updateTriageColor = reg_updateTriageColor;
})();
