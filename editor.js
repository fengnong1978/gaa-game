/**
 * editor.js - 可视化编辑器（人物预设、等比画面预览、文件夹记忆）
 */
const Editor = {
    projectData: null,
    currentSceneId: null,
    VD_SCALE: 0.38,
    labelSearchScope: 'global',
    labelSearchText: '',
    /** 为 true 时步骤列表渲染在独立整页 #steps-list-page，否则在场景表单内 #steps-list */
    stepsPageVisible: false,
    castSearchText: '',
    activeCastId: '',
    sceneSearchText: '',

    init() {
        AssetManager.init();
        this.setupEvents();
        this.populateEffectSelects();
        this.generateAssetCards();
        this.setupVisualDirector();
    },

    populateEffectSelects() {
        if (typeof StoryEffectsRegistry === 'undefined') return;
        const esc = v =>
            String(v ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;');
        const fillSelect = (id, list) => {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = list.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
        };
        fillSelect('edit-fx-entrance', StoryEffectsRegistry.ENTRANCE);
        const ov = document.getElementById('edit-fx-overlays');
        if (ov) {
            ov.innerHTML = '';
            [...StoryEffectsRegistry.OVERLAY_BUILTIN, ...StoryEffectsRegistry.PARTICLE_PRESETS].forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.id;
                opt.textContent = o.label;
                ov.appendChild(opt);
            });
        }
        fillSelect('edit-fx-combo', StoryEffectsRegistry.COMBO);
        fillSelect('edit-fx-dramatic', StoryEffectsRegistry.DRAMATIC);
    },

    updateFxComboLock() {
        const combo = document.getElementById('edit-fx-combo');
        const locked = combo && combo.value;
        ['edit-fx-entrance', 'edit-fx-overlays'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !!locked;
        });
    },

    migrateProjectData(project) {
        if (!project) return;
        if (!project.characterRoster) project.characterRoster = [];
        if (!project.scenes) return;
        if (!project.unifiedAttributes) project.unifiedAttributes = [];
        if (!project.relationAttributes) project.relationAttributes = {};
        project.scenes.forEach(scene => {
            if (scene.appearedValue == null) scene.appearedValue = 0;
            scene.background = scene.background || {};
            const bg = scene.background;
            if (bg.fitPanX == null && bg.offsetX != null) bg.fitPanX = bg.offsetX;
            if (bg.fitPanY == null && bg.offsetY != null) bg.fitPanY = bg.offsetY;
            if (bg.fitZoom == null && bg.scale != null) bg.fitZoom = bg.scale;
            if (bg.fitPanX == null) bg.fitPanX = 0;
            if (bg.fitPanY == null) bg.fitPanY = 0;
            if (bg.fitZoom == null) bg.fitZoom = 1;

            scene.character = scene.character || {};
            scene.character.layout = scene.character.layout || { panX: 0, panY: 0, zoom: 1 };
            if (scene.characterRef == null) scene.characterRef = '';
            if (scene.expression == null) scene.expression = '';
            scene.storyGraphic = scene.storyGraphic || {};
            scene.music = scene.music || { url: '', loop: true };
            if (scene.music.loop == null) scene.music.loop = true;
            if (typeof StoryEffectsRegistry !== 'undefined') {
                scene.effects = StoryEffectsRegistry.normalizeEffects(scene.effects);
            } else {
                scene.effects = scene.effects && typeof scene.effects === 'object' ? scene.effects : {};
                if (!Array.isArray(scene.effects.overlays)) scene.effects.overlays = [];
                if (scene.effects.cgEntrance == null) scene.effects.cgEntrance = '';
                if (scene.effects.combo == null) scene.effects.combo = '';
                if (scene.effects.dramatic == null) scene.effects.dramatic = '';
            }

            // steps（脚本结构）
            if (!Array.isArray(scene.steps)) {
                const steps = [];
                const oldText = typeof scene.text === 'string' ? scene.text : '';
                if (oldText.trim()) {
                    steps.push({
                        id: `step_${Date.now()}_dlg`,
                        type: 'dialogue',
                        speakerRef: scene.characterRef || '',
                        expression: scene.expression || '',
                        charMode: 'big',
                        mirror: false,
                        text: oldText,
                        effects: []
                    });
                }
                if (scene.storyGraphic && (scene.storyGraphic.embeddedDataUrl || scene.storyGraphic.url)) {
                    steps.unshift({
                        id: `step_${Date.now()}_cg`,
                        type: 'cg',
                        cg: { ...(scene.storyGraphic || {}) },
                        hideDialogue: true,
                        hideCharacter: true,
                        effects: []
                    });
                }
                if (Array.isArray(scene.options) && scene.options.length) {
                    steps.push({
                        id: `step_${Date.now()}_choice`,
                        type: 'choice',
                        options: scene.options.map(o => ({
                            text: o.text || '',
                            next: { type: 'scene', sceneId: o.target || 'start' },
                            effects: []
                        }))
                    });
                }
                scene.steps = steps;
            }
            scene.steps = (scene.steps || []).filter(Boolean).map((s, idx) => ({
                id: s.id || `${scene.id}_step_${idx}_${Date.now()}`,
                type: s.type || 'dialogue',
                effects: Array.isArray(s.effects) ? s.effects : [],
                ...s
            }));
            (scene.steps || []).forEach(st => {
                if (st.appearedValue == null) st.appearedValue = 0;
            });
            (scene.steps || []).forEach(st => {
                if (!st || st.type !== 'cg') return;
                if (st.cgLoop == null) st.cgLoop = true;
                if (st.cgStopAtStepId == null) st.cgStopAtStepId = '';
                if (st.cgMusicStopAtStepId == null) st.cgMusicStopAtStepId = '';
                if (st.cgMusicAlias == null) st.cgMusicAlias = '';
                if (st.cgMusicLoop == null) st.cgMusicLoop = true;
            });
        });
    },

    setupEvents() {
        document.getElementById('tab-story').onclick = () => this.switchTab('story');
        document.getElementById('tab-cast').onclick = () => this.switchTab('cast');
        document.getElementById('tab-assets').onclick = () => this.switchTab('assets');

        const btnNewProject = document.getElementById('btn-new-project');
        if (btnNewProject) {
            btnNewProject.onclick = () => this.createNewProject();
        }
        document.getElementById('btn-load').onclick = async () => {
            const file = await this.pickProjectFileWithMemory();
            if (file) await this.loadProjectFromFile(file);
        };
        const btnOpenLast = document.getElementById('btn-open-last-project');
        if (btnOpenLast) {
            btnOpenLast.onclick = () => this.openLastProjectFromMemory();
        }
        const btnDebug = document.getElementById('btn-debug-run');
        if (btnDebug) {
            btnDebug.onclick = () => {
                window.open('index_debug.html', '_blank', 'noopener,noreferrer');
            };
        }
        document.getElementById('load-project').onchange = async e => {
            const file = e.target.files[0];
            if (!file) return;
            await this.loadProjectFromFile(file);
        };
        document.getElementById('btn-save').onclick = () => {
            if (!this.projectData) return alert('请先加载项目');
            this.openExportModal();
        };
        const btnBindRoot = document.getElementById('btn-bind-project-root');
        if (btnBindRoot) {
            btnBindRoot.onclick = () => this.bindProjectRootFolder();
        }
        document.getElementById('btn-toggle-vd').onclick = () => {
            const col = document.getElementById('visual-director-column');
            const btn = document.getElementById('btn-toggle-vd');
            if (!col || !btn) return;
            const opening = !col.classList.contains('open');
            col.classList.toggle('open', opening);
            btn.textContent = opening ? '关闭背景和立绘画面预览' : '背景和立绘画面预览';
            if (opening) this.refreshVisualDirector();
        };

        const btnToggleScenePanel = document.getElementById('btn-toggle-scene-panel');
        const btnOpenScenePanel = document.getElementById('btn-open-scene-panel');
        const toggleScenePanel = () => {
            const panel = document.getElementById('scene-list-panel');
            if (!panel) return;
            const collapsed = !panel.classList.contains('collapsed');
            panel.classList.toggle('collapsed', collapsed);
            const text = collapsed ? '展开' : '收起';
            if (btnToggleScenePanel) btnToggleScenePanel.textContent = text;
            if (btnOpenScenePanel) btnOpenScenePanel.style.display = collapsed ? 'inline-block' : 'none';
        };
        if (btnToggleScenePanel) {
            btnToggleScenePanel.onclick = toggleScenePanel;
        }
        if (btnOpenScenePanel) {
            btnOpenScenePanel.onclick = toggleScenePanel;
        }
        const sceneSearchInput = document.getElementById('scene-search-input');
        const btnSceneSearch = document.getElementById('btn-scene-search');
        if (sceneSearchInput) {
            sceneSearchInput.oninput = () => {
                this.sceneSearchText = sceneSearchInput.value || '';
            };
            sceneSearchInput.onkeydown = ev => {
                if (ev.key !== 'Enter') return;
                this.sceneSearchText = sceneSearchInput.value || '';
                this.refreshSceneList();
            };
        }
        if (btnSceneSearch) {
            btnSceneSearch.onclick = () => {
                this.sceneSearchText = sceneSearchInput ? sceneSearchInput.value || '' : '';
                this.refreshSceneList();
            };
        }

        document.getElementById('btn-add-scene').onclick = () => {
            if (!this.projectData) return alert('请先加载项目');
            const newId = 'scene_' + Date.now();
            this.projectData.scenes.push({
                id: newId,
                name: '未命名场景',
                characterName: '',
                characterRef: '',
                expression: '',
                character: { url: '', layout: { panX: 0, panY: 0, zoom: 1 } },
                background: { url: '', fitPanX: 0, fitPanY: 0, fitZoom: 1 },
                storyGraphic: {},
                effects: { cgEntrance: '', overlays: [], combo: '', dramatic: '' },
                text: '...',
                options: [],
                appearedValue: 0,
                steps: [
                    {
                        id: `step_${Date.now()}_dlg`,
                        type: 'dialogue',
                        speakerRef: '',
                        expression: '',
                        charMode: 'big',
                        mirror: false,
                        text: '',
                        appearedValue: 0,
                        effects: []
                    }
                ]
            });
            this.refreshSceneList();
            this.selectScene(newId);
        };

        document.getElementById('btn-delete-scene').onclick = () => {
            if (!this.currentSceneId) return;
            const isReferenced = this.projectData.scenes.some(
                s => s.options && s.options.some(opt => opt.target === this.currentSceneId)
            );
            if (isReferenced) {
                if (!confirm('警告：有其他场景的选项指向此场景，删除后会导致跳转失效。是否继续？')) return;
            }
            this.projectData.scenes = this.projectData.scenes.filter(s => s.id !== this.currentSceneId);
            this.currentSceneId = null;
            this.refreshSceneList();
            document.getElementById('editor-form').style.display = 'none';
            document.getElementById('editor-content').querySelector('.empty-msg').style.display = 'block';
        };

        const inputs = [
            'edit-name',
            'edit-id',
            'edit-text',
            'edit-bg-url',
            'edit-bg-fit-pan-x',
            'edit-bg-fit-pan-y',
            'edit-bg-fit-zoom',
            'edit-music-loop'
        ];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.oninput = () => this.syncToData();
        });

        const fxCombo = document.getElementById('edit-fx-combo');
        if (fxCombo) {
            fxCombo.onchange = () => {
                this.updateFxComboLock();
                this.syncToData();
            };
        }
        ['edit-fx-entrance', 'edit-fx-overlays', 'edit-fx-dramatic'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onchange = () => this.syncToData();
        });

        document.getElementById('btn-add-cast').onclick = () => this.addCastMember();
        const btnUnified = document.getElementById('btn-edit-unified-attrs');
        if (btnUnified) {
            btnUnified.onclick = () => this.openUnifiedAttrsModal();
        }
        const castSearchInput = document.getElementById('cast-search-input');
        if (castSearchInput) {
            castSearchInput.oninput = () => {
                this.castSearchText = castSearchInput.value || '';
                this.refreshCastList();
            };
        }
        const castPicker = document.getElementById('cast-picker');
        if (castPicker) {
            castPicker.onchange = () => {
                this.activeCastId = castPicker.value || '';
                this.refreshCastList();
            };
        }
        const btnBackFromCast = document.getElementById('btn-back-from-cast');
        if (btnBackFromCast) btnBackFromCast.onclick = () => this.switchTab('story');
        const btnBackFromAssets = document.getElementById('btn-back-from-assets');
        if (btnBackFromAssets) btnBackFromAssets.onclick = () => this.switchTab('story');

        const btnOpenStepsPage = document.getElementById('btn-open-steps-page');
        const btnCloseStepsPage = document.getElementById('btn-close-steps-page');
        if (btnOpenStepsPage) {
            btnOpenStepsPage.onclick = () => {
                if (!this.currentSceneId) {
                    alert('请先在左侧场景列表中选择一个场景。');
                    return;
                }
                this.openStepsEditorPage();
            };
        }
        if (btnCloseStepsPage) {
            btnCloseStepsPage.onclick = () => this.closeStepsEditorPage();
        }
        const btnCloseStepFxPage = document.getElementById('btn-close-step-fx-page');
        if (btnCloseStepFxPage) {
            btnCloseStepFxPage.onclick = () => this.closeStepFxPage();
        }

        this._wireLabelQuickPickHandlers();

        const wireLabelScope = id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.onchange = () => {
                this.setLabelSearchScope(el.value);
                this.refreshGlobalLabelsDatalist();
                this.renderSteps();
            };
        };
        wireLabelScope('label-search-scope');
        wireLabelScope('label-search-scope-page');

        const wireLabelSearchBtn = (btnId, inputId) => {
            const labelInput = document.getElementById(inputId);
            const labelSearchBtn = document.getElementById(btnId);
            if (!labelInput || !labelSearchBtn) return;
            labelSearchBtn.onclick = () => {
                this.setLabelSearchInputValue(labelInput.value);
                this.renderSteps();
            };
        };
        wireLabelSearchBtn('btn-label-search', 'label-search-input');
        wireLabelSearchBtn('btn-label-search-page', 'label-search-input-page');

        const stepsPageSceneSel = document.getElementById('steps-page-scene-select');
        if (stepsPageSceneSel) {
            stepsPageSceneSel.onchange = () => {
                const id = stepsPageSceneSel.value;
                if (!id) return;
                this.selectScene(id);
            };
        }
        const btnUploadBgInline = document.getElementById('btn-upload-bg-inline');
        if (btnUploadBgInline) {
            btnUploadBgInline.onclick = async () => {
                const scene = this.getScene(this.currentSceneId);
                if (!scene) return;
                const result = await this.pickAndRegisterAsset('backgrounds', `scene-bg-${scene.id}`);
                if (!result) return;
                scene.background = scene.background || {};
                scene.background.url = result.alias;
                this.updateDropdowns(scene);
                this.refreshVisualDirector();
            };
        }
        const btnUploadMusicInline = document.getElementById('btn-upload-music-inline');
        if (btnUploadMusicInline) {
            btnUploadMusicInline.onclick = async () => {
                const scene = this.getScene(this.currentSceneId);
                if (!scene) return;
                const result = await this.pickAndRegisterAsset('music', `scene-music-${scene.id}`);
                if (!result) return;
                scene.music = scene.music || {};
                scene.music.url = result.alias;
                this.updateDropdowns(scene);
            };
        }
        const btnClearSceneBgm = document.getElementById('btn-clear-scene-bgm');
        if (btnClearSceneBgm) {
            btnClearSceneBgm.onclick = () => {
                const scene = this.getScene(this.currentSceneId);
                if (!scene) return;
                scene.music = scene.music || { loop: true };
                scene.music.url = '';
                this.updateDropdowns(scene);
            };
        }
    },

    openExportModal() {
        if (!this.projectData) return;
        const current = !!(this.projectData.buildConfig && this.projectData.buildConfig.publishMode);
        this._openModal('导出项目', (root) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '10px';
            row.style.marginBottom = '12px';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = current;
            const lab = document.createElement('label');
            lab.style.display = 'flex';
            lab.style.alignItems = 'center';
            lab.style.gap = '8px';
            lab.appendChild(cb);
            lab.appendChild(document.createTextNode('发布模式（强制关闭固定随机种子、屏蔽调试）'));
            row.appendChild(lab);
            root.appendChild(row);

            const hint = document.createElement('div');
            hint.style.color = '#aaa';
            hint.style.fontSize = '12px';
            hint.style.marginBottom = '12px';
            hint.textContent = '调试试玩（index_debug.html）仍可使用，但发布模式下运行端会忽略固定种子。';
            root.appendChild(hint);

            const btn = document.createElement('button');
            btn.textContent = '导出 JSON';
            btn.onclick = () => {
                this.projectData.buildConfig = { ...(this.projectData.buildConfig || {}), publishMode: cb.checked };
                StorageManager.exportProject(this.projectData, { publishMode: cb.checked });
            };
            root.appendChild(btn);

            const btnBundle = document.createElement('button');
            btnBundle.textContent = '导出发布包（推荐）';
            btnBundle.style.marginLeft = '10px';
            btnBundle.onclick = () => {
                const warnings = StorageManager.validatePublishBundle(this.projectData);
                if (warnings.length) {
                    const ok = confirm(`发布包校验提示：\n- ${warnings.join('\n- ')}\n\n仍然继续导出吗？`);
                    if (!ok) return;
                }
                StorageManager.exportPublishBundle(this.projectData, {
                    fileName: `${this.projectData.projectName || 'storyengine'}_publish_bundle.json`
                });
            };
            root.appendChild(btnBundle);
        });
    },

    _openModal(title, renderFn) {
        const mask = document.getElementById('modal-mask');
        const body = document.getElementById('modal-body');
        const t = document.getElementById('modal-title');
        const close = document.getElementById('modal-close');
        const isStepFxPage = String(title || '').includes('特效音效');
        if (isStepFxPage) {
            const fxView = document.getElementById('view-step-fx');
            const fxBody = document.getElementById('step-fx-page-content');
            const fxSub = document.getElementById('step-fx-page-subtitle');
            if (fxView && fxBody && fxSub) {
                const scene = this.getScene(this.currentSceneId);
                const tb = document.getElementById('toolbar');
                if (tb) tb.style.display = 'none';
                ['view-story', 'view-cast', 'view-assets', 'view-steps'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });
                fxView.style.display = 'block';
                fxBody.innerHTML = '';
                fxSub.textContent = `场景：${scene ? scene.name || scene.id : ''} · ${title}`;
                renderFn(fxBody);
                return;
            }
        }
        if (!mask || !body || !t || !close) return;
        t.textContent = title;
        body.innerHTML = '';
        renderFn(body);
        mask.classList.add('open');
        const onClose = () => {
            mask.classList.remove('open');
            close.onclick = null;
            mask.onclick = null;
        };
        close.onclick = onClose;
        mask.onclick = (ev) => {
            if (ev.target === mask) onClose();
        };
    },

    closeStepFxPage() {
        const fxView = document.getElementById('view-step-fx');
        if (fxView) fxView.style.display = 'none';
        const tb = document.getElementById('toolbar');
        if (tb) tb.style.display = 'flex';
        if (this.stepsPageVisible) {
            const vs = document.getElementById('view-steps');
            if (vs) vs.style.display = 'block';
            return;
        }
        const tab = document.querySelector('.tab.active');
        const active = tab ? tab.id.replace('tab-', '') : 'story';
        this.switchTab(active);
    },

    openStepFxModal(step, stepNumber = 0) {
        if (!step) return;
        const cfg = step.stepFx || {
            shock: '',
            romantic: { combo: '', entry: '', ambient: '', exit: '' },
            sadnessCombo: '',
            shockCombo: ''
        };
        step.stepFx = cfg;
        cfg.romantic = cfg.romantic || { combo: '', entry: '', ambient: '', exit: '' };

        const shockItems = ['打击', '愤怒', '闪电', '绝望', '混乱', '冰点', '崩塌'];
        const romanticCombos = ['初见组合', '热恋组合', '如梦组合', '星空誓言', '午后私语', '相拥时刻', '纯白告白', '枫林漫步', '雨后清晨', '自动浪漫'];
        const romanticEntry = ['Dreamy Fade', 'Glow Expand', 'Mist Reveal', 'Heartbeat Scale', 'Ken Burns In'];
        const particleAliases = (typeof AssetManager !== 'undefined' && AssetManager.getList ? AssetManager.getList('particles') : []) || [];
        const romanticAmbient = ['樱花', '黄叶', '红叶', ...particleAliases, 'Golden Bokeh', 'Soft Glow', 'Heart Bubbles']
            .filter((v, i, arr) => v && arr.indexOf(v) === i);
        const romanticExit = ['Iris Out', 'Bokeh Blur', 'Light Dissolve', 'Color Fade', 'Slow Black'];
        const sadnessCombos = ['雨中独白', '幻灭时刻', '冰冷记忆', '绝望深渊', '终焉仪式'];
        const shockCombos = ['真相大白', '系统崩溃', '心跳骤停', '惊愕瞬间', '意识断裂'];

        this._openModal(`步骤 #${stepNumber} 特效音效`, root => {
            root.classList.add('step-fx-modal-body');

            const closeAllMenus = () => {
                root.querySelectorAll('.step-fx-dd-menu.open').forEach(m => m.classList.remove('open'));
            };
            root.addEventListener('click', e => {
                if (!e.target.closest('.step-fx-dd')) closeAllMenus();
            });

            const makeFxDropdown = (catLabel, optionsOrGetter, getVal, setVal) => {
                const getOptionList =
                    typeof optionsOrGetter === 'function' ? optionsOrGetter : () => optionsOrGetter;

                const wrap = document.createElement('div');
                wrap.className = 'step-fx-dd';

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'step-fx-dd-btn';
                const cat = document.createElement('span');
                cat.className = 'step-fx-dd-cat';
                cat.textContent = catLabel;
                const valEl = document.createElement('span');
                valEl.className = 'step-fx-dd-val';
                const arr = document.createElement('span');
                arr.className = 'step-fx-dd-arrow';
                arr.textContent = '▼';
                btn.appendChild(cat);
                btn.appendChild(valEl);
                btn.appendChild(arr);

                const menu = document.createElement('div');
                menu.className = 'step-fx-dd-menu';

                const syncDisplay = () => {
                    const v = getVal() || '';
                    valEl.textContent = v || '（无）';
                    valEl.classList.toggle('is-empty', !v);
                };
                syncDisplay();

                const rebuildMenu = () => {
                    menu.innerHTML = '';
                    const addItem = (text, value) => {
                        const it = document.createElement('button');
                        it.type = 'button';
                        it.className = 'step-fx-dd-item';
                        it.textContent = text;
                        it.onclick = ev => {
                            ev.stopPropagation();
                            setVal(value);
                            syncDisplay();
                            menu.classList.remove('open');
                        };
                        menu.appendChild(it);
                    };
                    addItem('（无）', '');
                    getOptionList().forEach(x => addItem(x, x));
                };
                rebuildMenu();

                btn.onclick = ev => {
                    ev.stopPropagation();
                    if (btn.disabled) return;
                    const willOpen = !menu.classList.contains('open');
                    closeAllMenus();
                    if (willOpen) menu.classList.add('open');
                };

                wrap.appendChild(btn);
                wrap.appendChild(menu);
                return {
                    wrap,
                    syncDisplay,
                    rebuildMenu,
                    setLocked(locked) {
                        wrap.classList.toggle('is-locked', locked);
                        btn.disabled = locked;
                    }
                };
            };

            const grid = document.createElement('div');
            grid.className = 'step-fx-grid';

            const row1 = document.createElement('div');
            row1.className = 'step-fx-grid-row';
            const shock = makeFxDropdown(
                '冲击类',
                shockItems,
                () => cfg.shock || step.dramaticEffect || '',
                v => {
                    cfg.shock = v;
                    step.dramaticEffect = v;
                }
            );
            const sad = makeFxDropdown('悲伤组合', sadnessCombos, () => cfg.sadnessCombo || '', v => (cfg.sadnessCombo = v));
            const shk = makeFxDropdown('震惊组合', shockCombos, () => cfg.shockCombo || '', v => (cfg.shockCombo = v));
            row1.appendChild(shock.wrap);
            row1.appendChild(sad.wrap);
            row1.appendChild(shk.wrap);

            const row2 = document.createElement('div');
            row2.className = 'step-fx-grid-row';
            const romanticLock = { apply() {} };
            const rc = makeFxDropdown('浪漫组合', romanticCombos, () => cfg.romantic.combo || '', v => {
                cfg.romantic.combo = v;
                romanticLock.apply();
            });
            const re = makeFxDropdown('浪漫入场', romanticEntry, () => cfg.romantic.entry || '', v => (cfg.romantic.entry = v));
            const ra = makeFxDropdown('浪漫氛围', romanticAmbient, () => cfg.romantic.ambient || '', v => (cfg.romantic.ambient = v));
            const rx = makeFxDropdown('浪漫出场', romanticExit, () => cfg.romantic.exit || '', v => (cfg.romantic.exit = v));
            romanticLock.apply = () => {
                const lock = !!cfg.romantic.combo;
                re.setLocked(lock);
                ra.setLocked(lock);
                rx.setLocked(lock);
            };

            row2.appendChild(rc.wrap);
            row2.appendChild(re.wrap);
            row2.appendChild(ra.wrap);
            row2.appendChild(rx.wrap);

            const getSoundList = () =>
                (typeof AssetManager !== 'undefined' && AssetManager.getList ? AssetManager.getList('sounds') : []) || [];

            const sndDd = makeFxDropdown('音效', getSoundList, () => step.soundAlias || '', v => (step.soundAlias = v));
            const rebuildSoundOptions = () => sndDd.rebuildMenu();

            const row3 = document.createElement('div');
            row3.className = 'step-fx-grid-row';
            const upWrap = document.createElement('div');
            upWrap.className = 'step-fx-dd';
            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.className = 'step-fx-dd-btn step-fx-dd-btn-upload';
            upBtn.innerHTML =
                '<span class="step-fx-dd-cat">上传音效</span><span class="step-fx-dd-val is-empty">　</span><span class="step-fx-dd-arrow">▼</span>';
            upBtn.onclick = async ev => {
                ev.stopPropagation();
                closeAllMenus();
                const result = await this.pickAndRegisterAsset('sounds', `step-sound-${this.currentSceneId}-${step.id}`);
                if (!result) return;
                step.soundAlias = result.alias;
                rebuildSoundOptions();
                sndDd.syncDisplay();
            };
            upWrap.appendChild(upBtn);

            row3.appendChild(sndDd.wrap);
            row3.appendChild(upWrap);

            grid.appendChild(row1);
            grid.appendChild(row2);
            grid.appendChild(row3);
            root.appendChild(grid);

            romanticLock.apply();
        });
    },

    openEffectsModal(title, effectsArray) {
        if (!this.projectData) return;
        if (!Array.isArray(effectsArray)) effectsArray = [];
        const roster = this.projectData.characterRoster || [];
        const defs = this.projectData.unifiedAttributes || [];
        const relationDefs = this.projectData.relationAttributes || {};
        const scenes = this.projectData.scenes || [];
        const stepOptions = [];
        scenes.forEach(sc => {
            (sc.steps || []).forEach((st, idx) => {
                if (!st || !st.id) return;
                stepOptions.push({ id: st.id, label: `${sc.name || sc.id} · #${idx + 1} ${this.getStepTypeLabel(st.type || 'dialogue')}` });
            });
        });
        const unifiedKeys = ['存在', ...defs.map(d => d && d.key).filter(Boolean)];
        const relationSourceIds = roster
            .map(c => c && c.id)
            .filter(id => id && Object.keys((relationDefs && relationDefs[id]) || {}).length > 0);
        const getAllowedRelationTargets = fromId =>
            Object.keys((relationDefs && relationDefs[fromId]) || {}).filter(tid => tid && tid !== fromId);
        const ensureRelationPair = effect => {
            const from = effect.from || relationSourceIds[0] || roster[0]?.id || '';
            const allowed = getAllowedRelationTargets(from);
            if (!allowed.length) return { from, to: '' };
            const to = allowed.includes(effect.to) ? effect.to : allowed[0];
            return { from, to };
        };

        const clamp0100 = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

        this._openModal(title, (root) => {
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.gap = '10px';

            const render = () => {
                wrap.innerHTML = '';
                if (!effectsArray.length) {
                    const empty = document.createElement('div');
                    empty.style.color = '#888';
                    empty.textContent = '（无属性改动）';
                    wrap.appendChild(empty);
                }
                effectsArray.forEach((e, i) => {
                    const row = document.createElement('div');
                    row.style.display = 'grid';
                    row.style.gridTemplateColumns = '140px 1fr 70px';
                    row.style.gap = '10px';
                    row.style.alignItems = 'center';

                    const kind = document.createElement('select');
                    kind.innerHTML = `<option value="relation">关系好感</option><option value="unified">统一属性</option><option value="appearance">出现值</option>`;
                    kind.value =
                        e.kind === 'unified' ? 'unified' : e.kind === 'appearance' ? 'appearance' : (relationSourceIds.length ? 'relation' : 'unified');
                    kind.onchange = () => {
                        const v = kind.value;
                        if (v === 'relation') {
                            const from = relationSourceIds[0] || roster[0]?.id || '';
                            const to = getAllowedRelationTargets(from)[0] || '';
                            effectsArray[i] = { kind: 'relation', from, to, delta: 0 };
                        } else if (v === 'appearance') {
                            effectsArray[i] = { kind: 'appearance', targetType: 'scene', targetId: scenes[0] && scenes[0].id ? scenes[0].id : '', val: 1 };
                        } else {
                            effectsArray[i] = { kind: 'unified', charId: roster[0]?.id || '', key: unifiedKeys[0] || '存在', op: 'set', val: true };
                        }
                        render();
                    };

                    const cfg = document.createElement('div');
                    cfg.style.display = 'flex';
                    cfg.style.gap = '8px';
                    cfg.style.flexWrap = 'wrap';
                    cfg.style.alignItems = 'center';

                    if (kind.value === 'relation') {
                        const pair = ensureRelationPair(e);
                        e.from = pair.from;
                        e.to = pair.to;
                        const from = document.createElement('select');
                        from.innerHTML = relationSourceIds
                            .map(id => {
                                const c = roster.find(x => x.id === id);
                                return `<option value="${id}">${(c && (c.name || c.id)) || id}</option>`;
                            })
                            .join('');
                        from.value = e.from || relationSourceIds[0] || '';
                        from.onchange = () => {
                            e.from = from.value;
                            const allowed = getAllowedRelationTargets(e.from);
                            to.innerHTML = allowed
                                .map(tid => {
                                    const c = roster.find(x => x.id === tid);
                                    const nm = c ? c.name || c.id : tid;
                                    return `<option value="${tid}">${nm}</option>`;
                                })
                                .join('');
                            e.to = allowed[0] || '';
                            to.value = e.to;
                        };

                        const to = document.createElement('select');
                        const toAllowed = getAllowedRelationTargets(e.from);
                        to.innerHTML = toAllowed
                            .map(tid => {
                                const c = roster.find(x => x.id === tid);
                                const nm = c ? c.name || c.id : tid;
                                return `<option value="${tid}">${nm}</option>`;
                            })
                            .join('');
                        to.value = e.to || toAllowed[0] || '';
                        to.onchange = () => (e.to = to.value);
                        to.disabled = toAllowed.length === 0;

                        const delta = document.createElement('input');
                        delta.type = 'number';
                        delta.value = Number(e.delta) || 0;
                        delta.style.width = '90px';
                        delta.oninput = () => (e.delta = Number(delta.value) || 0);

                        cfg.appendChild(document.createTextNode('人物'));
                        cfg.appendChild(from);
                        cfg.appendChild(document.createTextNode('好感对象'));
                        cfg.appendChild(to);
                        cfg.appendChild(document.createTextNode('变化'));
                        cfg.appendChild(delta);
                        if (!relationSourceIds.length) {
                            const tip = document.createElement('span');
                            tip.style.color = '#ffb86b';
                            tip.textContent = '（请先在人物预设里配置关系好感）';
                            cfg.appendChild(tip);
                        }
                    } else if (kind.value === 'unified') {
                        const who = document.createElement('select');
                        who.innerHTML = roster.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('');
                        who.value = e.charId || roster[0]?.id || '';
                        who.onchange = () => (e.charId = who.value);

                        const key = document.createElement('select');
                        key.innerHTML = unifiedKeys.map(k => `<option value="${k}">${k}</option>`).join('');
                        key.value = e.key || unifiedKeys[0] || '存在';
                        key.onchange = () => {
                            e.key = key.value;
                            render();
                        };

                        const op = document.createElement('select');
                        op.innerHTML = `<option value="set">设为</option><option value="add">加减</option>`;
                        op.value = e.op === 'add' ? 'add' : 'set';
                        op.onchange = () => (e.op = op.value);

                        const defRow = defs.find(d => d.key === key.value);
                        const isBool = key.value === '存在' || (defRow && defRow.type === 'bool');
                        const val = document.createElement('input');
                        val.type = isBool ? 'text' : 'number';
                        val.value = isBool ? (e.val ? '是' : '否') : String(Number(e.val) || 0);
                        val.style.width = '110px';
                        val.oninput = () => {
                            if (isBool) {
                                const raw = String(val.value || '').trim();
                                e.val = raw === '是' || raw === 'true' || raw === '1';
                            } else {
                                e.val = Number(val.value) || 0;
                            }
                        };

                        cfg.appendChild(who);
                        cfg.appendChild(key);
                        cfg.appendChild(op);
                        cfg.appendChild(val);
                    } else {
                        e.targetType = e.targetType === 'step' ? 'step' : 'scene';
                        const targetType = document.createElement('select');
                        targetType.innerHTML = '<option value="scene">场景</option><option value="step">步骤</option>';
                        targetType.value = e.targetType;
                        const targetSel = document.createElement('select');
                        const renderTargets = () => {
                            if (targetType.value === 'scene') {
                                targetSel.innerHTML = scenes
                                    .map(sc => `<option value="${sc.id}">${sc.name || sc.id}</option>`)
                                    .join('');
                            } else {
                                targetSel.innerHTML = stepOptions
                                    .map(st => `<option value="${st.id}">${st.label}</option>`)
                                    .join('');
                            }
                            if ([...targetSel.options].some(op0 => op0.value === e.targetId)) targetSel.value = e.targetId;
                            else targetSel.value = targetSel.options[0] ? targetSel.options[0].value : '';
                            e.targetId = targetSel.value || '';
                            e.targetType = targetType.value;
                        };
                        targetType.onchange = renderTargets;
                        targetSel.onchange = () => (e.targetId = targetSel.value || '');
                        renderTargets();
                        const valSel = document.createElement('select');
                        valSel.innerHTML = '<option value="0">0（未出现）</option><option value="1">1（已出现）</option>';
                        valSel.value = Number(e.val) ? '1' : '0';
                        valSel.onchange = () => (e.val = Number(valSel.value) ? 1 : 0);
                        cfg.appendChild(targetType);
                        cfg.appendChild(targetSel);
                        cfg.appendChild(document.createTextNode('设为'));
                        cfg.appendChild(valSel);
                    }

                    const del = document.createElement('button');
                    del.className = 'mini-btn';
                    del.textContent = '删除';
                    del.onclick = () => {
                        effectsArray.splice(i, 1);
                        render();
                    };

                    row.appendChild(kind);
                    row.appendChild(cfg);
                    row.appendChild(del);
                    wrap.appendChild(row);
                });
            };

            const addBar = document.createElement('div');
            addBar.style.display = 'flex';
            addBar.style.gap = '10px';
            const addRel = document.createElement('button');
            addRel.className = 'mini-btn';
            addRel.textContent = '+ 关系好感';
            addRel.onclick = () => {
                const from = relationSourceIds[0] || '';
                const to = getAllowedRelationTargets(from)[0] || '';
                if (!to) {
                    alert('请先在人物预设里为该人物增加至少一条关系好感属性。');
                    return;
                }
                effectsArray.push({ kind: 'relation', from, to, delta: 0 });
                render();
            };
            const addUni = document.createElement('button');
            addUni.className = 'mini-btn';
            addUni.textContent = '+ 统一属性';
            addUni.onclick = () => {
                const charId = roster[0]?.id || '';
                effectsArray.push({ kind: 'unified', charId, key: unifiedKeys[0] || '存在', op: 'set', val: true });
                render();
            };
            addBar.appendChild(addRel);
            addBar.appendChild(addUni);
            const addAppear = document.createElement('button');
            addAppear.className = 'mini-btn';
            addAppear.textContent = '+ 出现值';
            addAppear.onclick = () => {
                effectsArray.push({
                    kind: 'appearance',
                    targetType: 'scene',
                    targetId: scenes[0] && scenes[0].id ? scenes[0].id : '',
                    val: 1
                });
                render();
            };
            addBar.appendChild(addAppear);

            root.appendChild(addBar);
            root.appendChild(wrap);
            render();
        });
    },

    openRandomConditionModal(row, modalTitle = '随机候选条件') {
        if (!this.projectData || !row) return;
        const roster = this.projectData.characterRoster || [];
        const defs = this.projectData.unifiedAttributes || [];
        const relationDefs = this.projectData.relationAttributes || {};
        const scenes = this.projectData.scenes || [];
        const stepOptions = [];
        scenes.forEach(sc => {
            (sc.steps || []).forEach((st, idx) => {
                if (!st || !st.id) return;
                stepOptions.push({ id: st.id, label: `${sc.name || sc.id} · #${idx + 1} ${this.getStepTypeLabel(st.type || 'dialogue')}` });
            });
        });
        const unifiedKeys = ['存在', ...defs.map(d => d && d.key).filter(Boolean)];
        const relationSourceIds = roster
            .map(c => c && c.id)
            .filter(id => id && Object.keys((relationDefs && relationDefs[id]) || {}).length > 0);
        const getAllowedRelationTargets = fromId =>
            Object.keys((relationDefs && relationDefs[fromId]) || {}).filter(tid => tid && tid !== fromId);

        const c0 = row.condition || { type: 'var', key: '', op: '>=', value: 0 };
        row.condition = c0;

        this._openModal(modalTitle, (root) => {
            const box = document.createElement('div');
            box.style.display = 'flex';
            box.style.flexDirection = 'column';
            box.style.gap = '10px';

            const type = document.createElement('select');
            type.innerHTML =
                `<option value="var">变量</option><option value="relation">关系好感</option><option value="unified">统一属性</option><option value="appearance">出现值</option>`;
            type.value = c0.type || 'var';

            const op = document.createElement('select');
            op.innerHTML =
                `<option value=">=">>=</option><option value="<="><=</option><option value="==">==</option><option value=">">></option><option value="<"><</option><option value="!=">!=</option>`;
            op.value = c0.op || '>=';

            const renderCfg = () => {
                cfg.innerHTML = '';
                if (type.value === 'var') {
                    const key = document.createElement('input');
                    key.placeholder = '变量名，例如 affection';
                    key.value = c0.key || '';
                    key.oninput = () => (c0.key = key.value.trim());
                    const val = document.createElement('input');
                    val.type = 'number';
                    val.value = c0.value != null ? c0.value : 0;
                    val.oninput = () => (c0.value = Number(val.value) || 0);
                    cfg.appendChild(key);
                    cfg.appendChild(op);
                    cfg.appendChild(val);
                } else if (type.value === 'relation') {
                    const from = document.createElement('select');
                    from.innerHTML = relationSourceIds
                        .map(id => {
                            const c = roster.find(x => x.id === id);
                            return `<option value="${id}">${(c && (c.name || c.id)) || id}</option>`;
                        })
                        .join('');
                    from.value = c0.from || relationSourceIds[0] || '';
                    from.onchange = () => {
                        c0.from = from.value;
                        const allowed = getAllowedRelationTargets(c0.from);
                        to.innerHTML = allowed
                            .map(tid => {
                                const c = roster.find(x => x.id === tid);
                                const nm = c ? c.name || c.id : tid;
                                return `<option value="${tid}">${nm}</option>`;
                            })
                            .join('');
                        c0.to = allowed[0] || '';
                        to.value = c0.to;
                    };
                    const to = document.createElement('select');
                    const toAllowed = getAllowedRelationTargets(c0.from || from.value);
                    to.innerHTML = toAllowed
                        .map(tid => {
                            const c = roster.find(x => x.id === tid);
                            const nm = c ? c.name || c.id : tid;
                            return `<option value="${tid}">${nm}</option>`;
                        })
                        .join('');
                    to.value = c0.to || toAllowed[0] || '';
                    to.onchange = () => (c0.to = to.value);
                    to.disabled = toAllowed.length === 0;
                    const val = document.createElement('input');
                    val.type = 'number';
                    val.value = c0.value != null ? c0.value : 0;
                    val.oninput = () => (c0.value = Number(val.value) || 0);
                    cfg.appendChild(from);
                    cfg.appendChild(to);
                    cfg.appendChild(op);
                    cfg.appendChild(val);
                } else if (type.value === 'unified') {
                    const who = document.createElement('select');
                    who.innerHTML = roster.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('');
                    who.value = c0.charId || roster[0]?.id || '';
                    who.onchange = () => (c0.charId = who.value);
                    const key = document.createElement('select');
                    key.innerHTML = unifiedKeys.map(k => `<option value="${k}">${k}</option>`).join('');
                    key.value = c0.key || unifiedKeys[0] || '存在';
                    key.onchange = () => (c0.key = key.value);
                    const val = document.createElement('input');
                    val.type = 'text';
                    val.value = c0.value != null ? String(c0.value) : 'true';
                    val.oninput = () => {
                        const raw = String(val.value).trim();
                        c0.value = raw === '是' || raw === 'true' || raw === '1' ? true : raw === '否' || raw === 'false' || raw === '0' ? false : raw;
                    };
                    cfg.appendChild(who);
                    cfg.appendChild(key);
                    cfg.appendChild(op);
                    cfg.appendChild(val);
                } else {
                    c0.targetType = c0.targetType === 'step' ? 'step' : 'scene';
                    const targetType = document.createElement('select');
                    targetType.innerHTML = '<option value="scene">场景</option><option value="step">步骤</option>';
                    targetType.value = c0.targetType;
                    const targetSel = document.createElement('select');
                    const renderTargets = () => {
                        if (targetType.value === 'scene') {
                            targetSel.innerHTML = scenes
                                .map(sc => `<option value="${sc.id}">${sc.name || sc.id}</option>`)
                                .join('');
                        } else {
                            targetSel.innerHTML = stepOptions
                                .map(st => `<option value="${st.id}">${st.label}</option>`)
                                .join('');
                        }
                        if ([...targetSel.options].some(op0 => op0.value === c0.targetId)) targetSel.value = c0.targetId;
                        else targetSel.value = targetSel.options[0] ? targetSel.options[0].value : '';
                        c0.targetType = targetType.value;
                        c0.targetId = targetSel.value || '';
                    };
                    targetType.onchange = renderTargets;
                    targetSel.onchange = () => (c0.targetId = targetSel.value || '');
                    renderTargets();
                    const valSel = document.createElement('select');
                    valSel.innerHTML = '<option value="0">0（未出现）</option><option value="1">1（已出现）</option>';
                    valSel.value = Number(c0.value) ? '1' : '0';
                    valSel.onchange = () => (c0.value = Number(valSel.value) ? 1 : 0);
                    cfg.appendChild(targetType);
                    cfg.appendChild(targetSel);
                    cfg.appendChild(op);
                    cfg.appendChild(valSel);
                }
            };

            type.onchange = () => {
                c0.type = type.value;
                if (type.value === 'var') {
                    c0.key = c0.key || '';
                    delete c0.from;
                    delete c0.to;
                    delete c0.charId;
                } else if (type.value === 'relation') {
                    c0.from = c0.from || relationSourceIds[0] || '';
                    c0.to = c0.to || getAllowedRelationTargets(c0.from)[0] || '';
                    delete c0.key;
                    delete c0.charId;
                    delete c0.targetType;
                    delete c0.targetId;
                } else {
                    if (type.value === 'appearance') {
                        c0.targetType = c0.targetType === 'step' ? 'step' : 'scene';
                        c0.targetId = c0.targetId || (c0.targetType === 'scene' ? (scenes[0] && scenes[0].id ? scenes[0].id : '') : (stepOptions[0] && stepOptions[0].id ? stepOptions[0].id : ''));
                        c0.value = Number(c0.value) ? 1 : 0;
                        delete c0.key;
                        delete c0.charId;
                        delete c0.from;
                        delete c0.to;
                    } else {
                    c0.charId = c0.charId || roster[0]?.id || '';
                    c0.key = c0.key || unifiedKeys[0] || '存在';
                    delete c0.from;
                    delete c0.to;
                    delete c0.targetType;
                    delete c0.targetId;
                    }
                }
                renderCfg();
            };
            op.onchange = () => (c0.op = op.value);

            const cfg = document.createElement('div');
            cfg.style.display = 'flex';
            cfg.style.gap = '8px';
            cfg.style.flexWrap = 'wrap';

            const rowTop = document.createElement('div');
            rowTop.style.display = 'flex';
            rowTop.style.gap = '8px';
            rowTop.style.alignItems = 'center';
            rowTop.appendChild(type);
            rowTop.appendChild(op);

            const rowBtns = document.createElement('div');
            rowBtns.style.display = 'flex';
            rowBtns.style.gap = '8px';
            const clear = document.createElement('button');
            clear.className = 'mini-btn';
            clear.textContent = '清空条件（总是可选）';
            clear.onclick = () => {
                row.condition = null;
            };
            rowBtns.appendChild(clear);

            box.appendChild(rowTop);
            box.appendChild(cfg);
            box.appendChild(rowBtns);
            root.appendChild(box);
            renderCfg();
        });
    },

    openDialogueCharLayoutModal(step, scene) {
        if (!step || step.type !== 'dialogue' || !scene) return;
        const sceneLay = LayoutHelpers.normalizeCharacterLayout(scene.character);
        if (!step.charLayout || typeof step.charLayout !== 'object') {
            step.charLayout = { panX: sceneLay.panX, panY: sceneLay.panY, zoom: sceneLay.zoom };
        } else {
            const cur = LayoutHelpers.normalizeCharacterLayout({ layout: step.charLayout });
            step.charLayout = { panX: cur.panX, panY: cur.panY, zoom: cur.zoom };
        }
        const L = step.charLayout;
        const vdScale = this.VD_SCALE;
        const toSceneDelta = (dx, dy) => ({ dx: dx / vdScale, dy: dy / vdScale });

        this._openModal('对白步骤 · 立绘位置', root => {
            root.classList.add('charpos-modal-body');

            const hint = document.createElement('p');
            hint.className = 'charpos-modal-hint';
            hint.textContent =
                '仅本步生效；未设置时试玩沿用场景默认立绘位置。在预览中拖拽平移立绘，滚轮缩放；小图模式下灰色条表示对话框区域。';
            root.appendChild(hint);

            const outer = document.createElement('div');
            outer.className = 'charpos-preview-outer';

            const vpInner = document.createElement('div');
            vpInner.className = 'charpos-preview-vp';

            const bgLayer = document.createElement('div');
            bgLayer.className = 'charpos-preview-layer charpos-preview-bg';

            const charSlot = document.createElement('div');
            charSlot.className = 'charpos-preview-layer charpos-preview-char-slot';

            const dialogMock = document.createElement('div');
            dialogMock.className = 'charpos-preview-dialog-mock';
            const dialogCol = document.createElement('div');
            dialogCol.className = 'charpos-preview-dialog-col';
            const speakerRef = (step && step.speakerRef) || (scene && scene.characterRef) || '';
            const speakerName = speakerRef
                ? ((this.projectData.characterRoster || []).find(c => c.id === speakerRef) || {}).name || ''
                : '';
            const nameEl = document.createElement('div');
            nameEl.className = 'charpos-preview-dialog-name';
            nameEl.textContent = speakerName || '';
            nameEl.style.display = speakerName ? 'block' : 'none';
            const boxEl = document.createElement('div');
            boxEl.className = 'charpos-preview-dialog-box';
            const textEl = document.createElement('div');
            textEl.className = 'charpos-preview-dialog-text';
            textEl.textContent = '对白框占位';
            boxEl.appendChild(textEl);
            dialogCol.appendChild(nameEl);
            dialogCol.appendChild(boxEl);
            dialogMock.appendChild(dialogCol);

            vpInner.appendChild(bgLayer);
            vpInner.appendChild(charSlot);
            vpInner.appendChild(dialogMock);
            outer.appendChild(vpInner);
            root.appendChild(outer);

            const status = document.createElement('div');
            status.className = 'charpos-modal-status';
            root.appendChild(status);

            const btnRow = document.createElement('div');
            btnRow.className = 'charpos-modal-actions';
            const reset = document.createElement('button');
            reset.className = 'mini-btn';
            reset.textContent = '恢复为场景默认';
            btnRow.appendChild(reset);
            root.appendChild(btnRow);

            const updateStatus = () => {
                const lay = LayoutHelpers.normalizeCharacterLayout({ layout: L });
                status.textContent = `偏移 X ${Math.round(lay.panX)} · Y ${Math.round(lay.panY)} · 缩放 ${lay.zoom.toFixed(2)}（与试玩 1280×720 逻辑坐标一致）`;
            };
            const calcSmallSlotHeight = () => {
                // 运行端逻辑等价：slotH = dialogueBox.top - canvas.top - 4
                // 在预览里（同一 1280x720 坐标）可等价为：720 - bottom(24) - dialogueBoxHeight - 4
                const DIALOG_BOTTOM = 24;
                const boxH = boxEl.offsetHeight || 136;
                const raw = LayoutHelpers.VIEW_H - DIALOG_BOTTOM - boxH - 4;
                return Math.max(48, Math.min(LayoutHelpers.VIEW_H, raw));
            };

            const paintBackground = () => {
                bgLayer.innerHTML = '';
                const bgNorm = LayoutHelpers.normalizeBackground(scene.background || {});
                const bgAlias = scene.background && scene.background.url;
                if (!bgAlias) return;
                const bgPath =
                    typeof AssetManager !== 'undefined' && AssetManager.getPath
                        ? AssetManager.getPath('backgrounds', bgAlias) || bgAlias
                        : bgAlias;
                const img = new Image();
                img.src = bgPath;
                const paint = () => LayoutHelpers.applyBackgroundContain(img, bgNorm);
                if (img.complete && img.naturalWidth) paint();
                else img.onload = paint;
                bgLayer.appendChild(img);
            };

            const paintCharacter = () => {
                charSlot.innerHTML = '';
                const mode = step.charMode || 'big';
                dialogMock.style.display = mode === 'small' ? 'flex' : 'none';

                const charPath = CharacterBinding.resolveSpriteUrlForStep(scene, step, this.projectData);
                if (!charPath) {
                    const ph = document.createElement('div');
                    ph.className = 'charpos-preview-empty';
                    ph.textContent = '（无立绘：请在本步骤选择说话人并绑定立绘后再调整位置）';
                    charSlot.appendChild(ph);
                    updateStatus();
                    return;
                }

                const lay = LayoutHelpers.normalizeCharacterLayout({ layout: L });
                const mirror = !!step.mirror;

                const wrap = document.createElement('div');
                wrap.className = 'charpos-preview-char-wrap';
                wrap.style.transform = `translateX(calc(-50% + ${lay.panX}px)) translateY(${lay.panY}px) scale(${lay.zoom})`;

                if (mode === 'small') {
                    const slotH = calcSmallSlotHeight();
                    wrap.style.top = '0';
                    wrap.style.height = `${slotH}px`;
                    wrap.style.bottom = 'auto';
                } else {
                    wrap.style.top = '0';
                    wrap.style.bottom = '0';
                    wrap.style.height = '';
                }

                const img = new Image();
                img.src = charPath;
                img.style.height = '100%';
                img.style.width = 'auto';
                img.style.objectFit = 'contain';
                if (mirror) img.style.transform = 'scaleX(-1)';
                wrap.appendChild(img);
                charSlot.appendChild(wrap);
                updateStatus();
            };

            const paint = () => {
                paintBackground();
                paintCharacter();
            };
            paint();

            let drag = null;
            const onMove = ev => {
                if (!drag) return;
                const { dx, dy } = toSceneDelta(ev.clientX - drag.sx, ev.clientY - drag.sy);
                L.panX = drag.startPanX + dx;
                L.panY = drag.startPanY + dy;
                paintCharacter();
            };
            const onUp = () => {
                drag = null;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };

            vpInner.addEventListener('mousedown', ev => {
                if (ev.button !== 0) return;
                drag = {
                    sx: ev.clientX,
                    sy: ev.clientY,
                    startPanX: L.panX || 0,
                    startPanY: L.panY || 0
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });

            vpInner.addEventListener(
                'wheel',
                ev => {
                    ev.preventDefault();
                    const factor = Math.exp(-ev.deltaY * 0.0015);
                    const z = (L.zoom != null ? L.zoom : 1) * factor;
                    L.zoom = Math.min(6, Math.max(0.15, z));
                    paintCharacter();
                },
                { passive: false }
            );

            reset.onclick = () => {
                const b = LayoutHelpers.normalizeCharacterLayout(scene.character);
                L.panX = b.panX;
                L.panY = b.panY;
                L.zoom = b.zoom;
                paintCharacter();
            };
        });
    },

    openUnifiedAttrsModal() {
        if (!this.projectData) return alert('请先加载项目');
        if (!Array.isArray(this.projectData.unifiedAttributes)) this.projectData.unifiedAttributes = [];
        const defs = this.projectData.unifiedAttributes;

        this._openModal('编辑统一属性', (root) => {
            const tip = document.createElement('div');
            tip.style.color = '#aaa';
            tip.style.margin = '0 0 10px';
            tip.textContent = '新增/删除统一属性后，所有角色都会拥有该属性；单角色可在其预设里覆盖初始值。系统保留统一属性「存在」。';
            root.appendChild(tip);

            const table = document.createElement('table');
            table.className = 'modal-table';
            table.innerHTML = `
                <thead>
                    <tr>
                        <th style="width:220px">属性名</th>
                        <th style="width:140px">类型</th>
                        <th style="width:220px">全角色默认初始值</th>
                        <th style="width:90px"></th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;
            const tb = table.querySelector('tbody');

            const render = () => {
                tb.innerHTML = '';
                defs.forEach((d, i) => {
                    const tr = document.createElement('tr');
                    const key = document.createElement('input');
                    key.value = d.key || '';
                    key.placeholder = '例如：体力';
                    key.oninput = () => (d.key = key.value.trim());

                    const type = document.createElement('select');
                    type.innerHTML = `<option value="number">数值</option><option value="bool">是否</option>`;
                    type.value = d.type === 'bool' ? 'bool' : 'number';
                    type.onchange = () => {
                        d.type = type.value;
                        if (d.type === 'bool') d.default = !!d.default;
                        else d.default = Number(d.default) || 0;
                        render();
                    };

                    const def = document.createElement('input');
                    if (type.value === 'bool') {
                        def.value = d.default ? '是' : '否';
                        def.readOnly = true;
                        def.style.opacity = '0.9';
                        const toggle = document.createElement('button');
                        toggle.className = 'mini-btn';
                        toggle.textContent = d.default ? '改为 否' : '改为 是';
                        toggle.onclick = () => {
                            d.default = !d.default;
                            render();
                        };
                        const box = document.createElement('div');
                        box.style.display = 'flex';
                        box.style.gap = '8px';
                        box.appendChild(def);
                        box.appendChild(toggle);
                        tr.appendChild(this._tdWrap(key));
                        tr.appendChild(this._tdWrap(type));
                        tr.appendChild(this._tdWrap(box));
                    } else {
                        def.type = 'number';
                        def.value = d.default != null ? d.default : 0;
                        def.oninput = () => (d.default = Number(def.value) || 0);
                        tr.appendChild(this._tdWrap(key));
                        tr.appendChild(this._tdWrap(type));
                        tr.appendChild(this._tdWrap(def));
                    }

                    const del = document.createElement('button');
                    del.className = 'mini-btn';
                    del.textContent = '删除';
                    del.onclick = () => {
                        const k = d.key;
                        defs.splice(i, 1);
                        this.cleanupDeletedAttributeRefs(k);
                        render();
                        this.refreshCastList();
                    };
                    tr.appendChild(this._tdWrap(del));
                    tb.appendChild(tr);
                });
            };

            root.appendChild(table);

            const addRow = document.createElement('div');
            addRow.style.display = 'flex';
            addRow.style.gap = '10px';
            addRow.style.marginTop = '12px';
            const add = document.createElement('button');
            add.textContent = '+ 新增统一属性';
            add.onclick = () => {
                defs.push({ key: '', type: 'number', default: 0 });
                render();
            };
            addRow.appendChild(add);
            root.appendChild(addRow);

            render();
        });
    },

    _tdWrap(node) {
        const td = document.createElement('td');
        td.appendChild(node);
        return td;
    },

    /** 删除统一属性后，自动清理所有步骤/选项对该属性的引用 */
    cleanupDeletedAttributeRefs(deletedKey) {
        if (!deletedKey) return;
        const proj = this.projectData;
        if (!proj || !Array.isArray(proj.scenes)) return;
        proj.scenes.forEach(sc => {
            (sc.steps || []).forEach(st => {
                if (Array.isArray(st.effects)) {
                    st.effects = st.effects.filter(e => !(e && e.kind === 'unified' && e.key === deletedKey));
                }
                if (st && st.type === 'choice' && Array.isArray(st.options)) {
                    st.options.forEach(o => {
                        if (Array.isArray(o.effects)) {
                            o.effects = o.effects.filter(e => !(e && e.kind === 'unified' && e.key === deletedKey));
                        }
                    });
                }
                if (st && st.type === 'random' && Array.isArray(st.table)) {
                    st.table.forEach(r => {
                        if (Array.isArray(r.effects)) {
                            r.effects = r.effects.filter(e => !(e && e.kind === 'unified' && e.key === deletedKey));
                        }
                    });
                }
            });
        });
    },

    _makeDefaultStep(type) {
        const id = `step_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        if (type === 'cg') {
            return {
                id,
                type: 'cg',
                cg: {},
                hideDialogue: true,
                hideCharacter: true,
                cgLoop: true,
                cgStopAtStepId: '',
                cgMusicStopAtStepId: '',
                cgMusicAlias: '',
                cgMusicLoop: true,
                dramaticEffect: '',
                soundAlias: '',
                effects: []
            };
        }
        if (type === 'choice') {
            const sid = (this.projectData.scenes && this.projectData.scenes[0] && this.projectData.scenes[0].id) || 'start';
            return {
                id,
                type: 'choice',
                options: [
                    {
                        text: '选项 1',
                        next: { type: 'scene', sceneId: sid, labelSuffix: '' },
                        effects: [],
                        condition: null
                    },
                    {
                        text: '选项 2',
                        next: { type: 'scene', sceneId: sid, labelSuffix: '' },
                        effects: [],
                        condition: null
                    }
                ],
                dramaticEffect: '',
                soundAlias: '',
                effects: []
            };
        }
        if (type === 'random') {
            const sid = (this.projectData.scenes && this.projectData.scenes[0] && this.projectData.scenes[0].id) || 'start';
            return {
                id,
                type: 'random',
                table: [
                    {
                        name: '结果 1',
                        weight: 50,
                        next: { type: 'scene', sceneId: sid, labelSuffix: '' },
                        condition: null,
                        appearedValue: 0,
                        effects: []
                    },
                    {
                        name: '结果 2',
                        weight: 50,
                        next: { type: 'scene', sceneId: sid, labelSuffix: '' },
                        condition: null,
                        appearedValue: 0,
                        effects: []
                    }
                ],
                dramaticEffect: '',
                soundAlias: '',
                appearedValue: 0,
                effects: []
            };
        }
        if (type === 'narration') {
            return { id, type: 'narration', text: '', dramaticEffect: '', soundAlias: '', appearedValue: 0, effects: [] };
        }
        return {
            id,
            type: 'dialogue',
            speakerRef: '',
            expression: '',
            charMode: 'big',
            mirror: false,
            text: '',
            dramaticEffect: '',
            soundAlias: '',
            appearedValue: 0,
            effects: []
        };
    },

    /** 更改步骤类型：保留 id、标签、属性改动、音效别名；其余按新类型默认 */
    changeStepTypeAtIndex(scene, idx, newType) {
        const step = scene.steps[idx];
        if (!step || step.type === newType) return;
        const id = step.id;
        const labelSuffix = step.labelSuffix || '';
        const effects = Array.isArray(step.effects) ? step.effects.slice() : [];
        const soundAlias = step.soundAlias || '';
        const fresh = this._makeDefaultStep(newType);
        fresh.id = id;
        fresh.labelSuffix = labelSuffix;
        fresh.effects = effects;
        fresh.soundAlias = soundAlias;
        scene.steps[idx] = fresh;
    },

    setupVisualDirector() {
        const wrap = document.getElementById('vd-viewport-wrap');
        const vp = document.getElementById('vd-viewport');
        if (!wrap || !vp) return;

        const toSceneDelta = (dx, dy) => ({
            dx: dx / this.VD_SCALE,
            dy: dy / this.VD_SCALE
        });

        let drag = null;

        const onMove = ev => {
            if (!drag || !this.currentSceneId) return;
            const scene = this.getScene(this.currentSceneId);
            const { dx, dy } = toSceneDelta(ev.clientX - drag.sx, ev.clientY - drag.sy);
            if (drag.mode === 'bg') {
                scene.background.fitPanX = drag.startPanX + dx;
                scene.background.fitPanY = drag.startPanY + dy;
                document.getElementById('edit-bg-fit-pan-x').value = Math.round(scene.background.fitPanX);
                document.getElementById('edit-bg-fit-pan-y').value = Math.round(scene.background.fitPanY);
            } else {
                scene.character.layout.panX = drag.startPanX + dx;
                scene.character.layout.panY = drag.startPanY + dy;
                const lx = document.getElementById('edit-char-layout-pan-x');
                const ly = document.getElementById('edit-char-layout-pan-y');
                if (lx) lx.value = Math.round(scene.character.layout.panX);
                if (ly) ly.value = Math.round(scene.character.layout.panY);
            }
            this.refreshVisualDirector();
        };

        const onUp = () => {
            drag = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        vp.addEventListener('mousedown', ev => {
            if (!this.currentSceneId) return;
            const mode = document.querySelector('input[name="vd-mode"]:checked')?.value || 'bg';
            const scene = this.getScene(this.currentSceneId);
            drag = {
                sx: ev.clientX,
                sy: ev.clientY,
                mode,
                startPanX:
                    mode === 'bg'
                        ? scene.background.fitPanX || 0
                        : scene.character.layout.panX || 0,
                startPanY:
                    mode === 'bg'
                        ? scene.background.fitPanY || 0
                        : scene.character.layout.panY || 0
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        vp.addEventListener(
            'wheel',
            ev => {
                if (!this.currentSceneId) return;
                ev.preventDefault();
                const scene = this.getScene(this.currentSceneId);
                const mode = document.querySelector('input[name="vd-mode"]:checked')?.value || 'bg';
                const factor = Math.exp(-ev.deltaY * 0.0015);
                if (mode === 'bg') {
                    const z = (scene.background.fitZoom || 1) * factor;
                    scene.background.fitZoom = Math.min(8, Math.max(0.15, z));
                    document.getElementById('edit-bg-fit-zoom').value = scene.background.fitZoom.toFixed(2);
                } else {
                    const z = (scene.character.layout.zoom || 1) * factor;
                    scene.character.layout.zoom = Math.min(6, Math.max(0.15, z));
                    const lz = document.getElementById('edit-char-layout-zoom');
                    if (lz) lz.value = scene.character.layout.zoom.toFixed(2);
                }
                this.refreshVisualDirector();
            },
            { passive: false }
        );

        document.querySelectorAll('input[name="vd-mode"]').forEach(r => {
            r.addEventListener('change', () => this.refreshVisualDirector());
        });
    },

    refreshVisualDirector() {
        const bgLayer = document.getElementById('vd-layer-bg');
        const charLayer = document.getElementById('vd-layer-char');
        if (!bgLayer || !charLayer || !this.currentSceneId) return;
        const scene = this.getScene(this.currentSceneId);
        bgLayer.innerHTML = '';
        charLayer.innerHTML = '';

        const bgNorm = LayoutHelpers.normalizeBackground(scene.background || {});
        const bgAlias = scene.background && scene.background.url;
        if (bgAlias) {
            const bgPath =
                typeof AssetManager !== 'undefined' && AssetManager.getPath
                    ? AssetManager.getPath('backgrounds', bgAlias) || bgAlias
                    : bgAlias;
            const img = new Image();
            img.src = bgPath;
            const paint = () => LayoutHelpers.applyBackgroundContain(img, bgNorm);
            if (img.complete && img.naturalWidth) paint();
            else img.onload = paint;
            bgLayer.appendChild(img);
        }

        const charPath = CharacterBinding.resolveSpriteUrl(scene, this.projectData);
        if (charPath) {
            const lay = LayoutHelpers.normalizeCharacterLayout(scene.character);
            const wrap = document.createElement('div');
            wrap.style.cssText =
                'position:absolute;left:50%;bottom:0;transform-origin:50% 100%;display:flex;align-items:flex-end;justify-content:center;pointer-events:none;';
            wrap.style.transform = `translateX(calc(-50% + ${lay.panX}px)) translateY(${lay.panY}px) scale(${lay.zoom})`;
            const img = new Image();
            img.src = charPath;
            img.style.maxHeight = '90%';
            img.style.width = 'auto';
            img.style.height = 'auto';
            img.style.objectFit = 'contain';
            wrap.appendChild(img);
            charLayer.appendChild(wrap);
        }
    },

    generateAssetCards() {
        const panel = document.getElementById('asset-manager-panel');
        panel.innerHTML = '';

        AssetManager.editorAssetTypes.forEach(type => {
            const card = document.createElement('div');
            card.className = 'asset-card';
            card.dataset.type = type;

            const titleMap = {
                characters: '🖼️ 角色立绘（可人物预设里一键上传，不必先来这里）',
                backgrounds: '🖼️ 背景图片',
                storyGraphics: '🎬 CG图片/视频',
                music: '🎵 背景音乐',
                sounds: '🔊 音效文件',
                particles: '✨ 粒子特效'
            };
            const folderHint = `注册后目录：assets/${this.assetTypeToSubdir(type)}/`;

            card.innerHTML = `
                <h3>${titleMap[type] || type}</h3>
                <div class="field-hint">${folderHint}</div>
                <div class="asset-upload">
                    <div class="asset-upload-actions">
                        <button type="button" class="btn-bind-dir">绑定本类资源文件夹…</button>
                        <button type="button" class="btn-pick">选择文件…</button>
                        <span class="asset-picked-label"></span>
                    </div>
                    <input type="file" class="asset-file-input" accept="${
                        type === 'sounds' || type === 'music'
                            ? 'audio/*'
                            : type === 'storyGraphics'
                                ? 'image/*,video/*'
                                : 'image/*'
                    }" style="display:none">
                    <input type="text" class="asset-name-input" placeholder="起个别名...">
                    <button type="button" class="btn-reg">注册</button>
                </div>
                <button type="button" class="btn-check-asset-list mini-btn">检查并清理失效资源</button>
                <button type="button" class="btn-toggle-asset-list mini-btn">已注册资源</button>
                <div class="asset-list" id="list-${type}" style="display:none"></div>
            `;

            const regBtn = card.querySelector('.btn-reg');
            const pickBtn = card.querySelector('.btn-pick');
            const bindDirBtn = card.querySelector('.btn-bind-dir');
            const fileInput = card.querySelector('.asset-file-input');
            const nameInput = card.querySelector('.asset-name-input');
            const pickedLabel = card.querySelector('.asset-picked-label');
            const toggleListBtn = card.querySelector('.btn-toggle-asset-list');
            const checkListBtn = card.querySelector('.btn-check-asset-list');
            const listEl = card.querySelector(`#list-${type}`);
            if (toggleListBtn && listEl) {
                toggleListBtn.onclick = () => {
                    const opening = listEl.style.display === 'none';
                    listEl.style.display = opening ? 'block' : 'none';
                    toggleListBtn.textContent = opening ? '收起已注册资源' : '已注册资源';
                };
            }
            if (checkListBtn) {
                checkListBtn.onclick = async () => {
                    await this.checkAndCleanupAssetType(type);
                };
            }

            const setPickedUI = f => {
                pickedLabel.textContent = f ? `已选：${f.name}` : '';
            };

            bindDirBtn.onclick = async () => {
                if (typeof window.showDirectoryPicker !== 'function') {
                    alert('当前环境不支持「记住文件夹」（需 Chrome/Edge 且建议用 http://localhost 打开页面）。');
                    return;
                }
                try {
                    const dir = await window.showDirectoryPicker();
                    await DirectoryMemory.saveDirectoryForAssetType(type, dir);
                    alert('已保存。下次「选择文件」会优先从该文件夹打开。');
                } catch (e) {
                    if (e && e.name !== 'AbortError') alert('绑定失败: ' + e);
                }
            };

            fileInput.onchange = () => {
                if (fileInput.files[0]) {
                    card._pendingFile = fileInput.files[0];
                    const fileName = fileInput.files[0].name;
                    const base =
                        fileName.lastIndexOf('.') > 0 ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
                    if (!nameInput.value.trim()) nameInput.value = base;
                    setPickedUI(card._pendingFile);
                }
            };

            pickBtn.onclick = async () => {
                const file = await Editor.pickAssetFileWithMemory(type, `asset-card-${type}`);
                if (!file) return;
                card._pendingFile = file;
                const base =
                    file.name.lastIndexOf('.') > 0 ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name;
                if (!nameInput.value.trim()) nameInput.value = base;
                setPickedUI(file);
                fileInput.value = '';
            };

            regBtn.onclick = async () => {
                let file = card._pendingFile || (fileInput.files && fileInput.files[0]);
                if (!file) {
                    file = await Editor.pickAssetFileWithMemory(type, `asset-card-${type}`);
                    if (!file) return alert('请先选择文件');
                    card._pendingFile = file;
                    setPickedUI(file);
                }
                const alias =
                    nameInput.value.trim() ||
                    (file.name.lastIndexOf('.') > 0 ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name);
                if (!alias) return alert('请输入资源别名');

                try {
                    const r = await this.registerAssetPreferDisk(type, alias, file);
                    if (!r.disk && r.compressed) {
                        alert('存储空间紧张，已自动压缩图片后保存。');
                    }
                } catch (err) {
                    alert('保存资源库失败: ' + err);
                    return;
                }

                this.refreshAssetList(type);
                if (this.currentSceneId) this.selectScene(this.currentSceneId);
                card._pendingFile = null;
                fileInput.value = '';
                nameInput.value = '';
                setPickedUI(null);
            };

            panel.appendChild(card);
        });
    },

    switchTab(tab) {
        this.stepsPageVisible = false;
        const fxView = document.getElementById('view-step-fx');
        if (fxView) fxView.style.display = 'none';
        const viewSteps = document.getElementById('view-steps');
        if (viewSteps) viewSteps.style.display = 'none';
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        document.getElementById('view-story').style.display = tab === 'story' ? 'flex' : 'none';
        document.getElementById('view-cast').style.display = tab === 'cast' ? 'flex' : 'none';
        document.getElementById('view-assets').style.display = tab === 'assets' ? 'flex' : 'none';
        if (tab === 'assets') {
            AssetManager.editorAssetTypes.forEach(type => this.refreshAssetList(type));
        }
        if (tab === 'cast') this.refreshCastList();
    },

    refreshAssetList(type) {
        const list = document.getElementById(`list-${type}`);
        if (!list) return;
        list.innerHTML = '';
        AssetManager.getList(type).forEach(name => {
            const div = document.createElement('div');
            div.className = 'asset-item';
            div.innerHTML = `<span>${name}</span>`;
            const btn = document.createElement('button');
            btn.innerText = '删除';
            btn.onclick = () => {
                AssetManager.removeAsset(type, name);
                this.refreshAssetList(type);
                this.refreshCastList();
            };
            div.appendChild(btn);
            list.appendChild(div);
        });
    },

    async _assetPathExistsOnProjectRoot(projectRoot, relPath) {
        if (!projectRoot || !relPath) return false;
        const clean = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = clean.split('/').filter(Boolean);
        if (!parts.length) return false;
        let dir = projectRoot;
        try {
            for (let i = 0; i < parts.length - 1; i++) {
                dir = await dir.getDirectoryHandle(parts[i], { create: false });
            }
            await dir.getFileHandle(parts[parts.length - 1], { create: false });
            return true;
        } catch {
            return false;
        }
    },

    _clearReferencesForRemovedAsset(type, name) {
        if (!this.projectData || !name) return 0;
        let changed = 0;
        const scenes = this.projectData.scenes || [];
        const roster = this.projectData.characterRoster || [];
        if (type === 'characters') {
            roster.forEach(c => {
                Object.values(c.expressions || {}).forEach(ex => {
                    if (ex && ex.spriteAsset === name) {
                        ex.spriteAsset = '';
                        changed++;
                    }
                });
            });
            scenes.forEach(sc => {
                if (sc.character && sc.character.url === name) {
                    sc.character.url = '';
                    changed++;
                }
            });
        } else if (type === 'backgrounds') {
            scenes.forEach(sc => {
                if (sc.background && sc.background.url === name) {
                    sc.background.url = '';
                    changed++;
                }
            });
        } else if (type === 'storyGraphics') {
            scenes.forEach(sc => {
                if (sc.storyGraphic && sc.storyGraphic.url === name) {
                    sc.storyGraphic.url = '';
                    changed++;
                }
                (sc.steps || []).forEach(st => {
                    if (st && st.type === 'cg' && st.cg && st.cg.url === name) {
                        st.cg.url = '';
                        changed++;
                    }
                });
            });
        } else if (type === 'music') {
            scenes.forEach(sc => {
                if (sc.music && sc.music.url === name) {
                    sc.music.url = '';
                    changed++;
                }
                (sc.steps || []).forEach(st => {
                    if (st && st.type === 'cg' && st.cgMusicAlias === name) {
                        st.cgMusicAlias = '';
                        changed++;
                    }
                });
            });
        } else if (type === 'sounds') {
            scenes.forEach(sc => {
                (sc.steps || []).forEach(st => {
                    if (st && st.soundAlias === name) {
                        st.soundAlias = '';
                        changed++;
                    }
                });
            });
        } else if (type === 'particles') {
            scenes.forEach(sc => {
                const ef = sc.effects || {};
                if (Array.isArray(ef.overlays)) {
                    const before = ef.overlays.length;
                    ef.overlays = ef.overlays.filter(x => x !== name);
                    changed += before - ef.overlays.length;
                }
                (sc.steps || []).forEach(st => {
                    const fx = st && st.stepFx && st.stepFx.romantic;
                    if (fx && fx.ambient === name) {
                        fx.ambient = '';
                        changed++;
                    }
                });
            });
        }
        return changed;
    },

    async checkAndCleanupAssetType(type) {
        if (!AssetManager || !AssetManager.library || !Array.isArray(AssetManager.library[type])) return;
        const rows = AssetManager.library[type].slice();
        if (!rows.length) {
            alert('该类型暂无已注册资源。');
            return;
        }
        const projectRoot =
            typeof DirectoryMemory !== 'undefined' && DirectoryMemory.getProjectRootDirectory
                ? await DirectoryMemory.getProjectRootDirectory()
                : null;
        const invalid = [];
        for (const row of rows) {
            if (!row || !row.name) continue;
            if (row.src) continue;
            const relPath = row.path || '';
            if (!relPath) {
                invalid.push({ name: row.name, reason: '无文件路径' });
                continue;
            }
            if (!/^assets\//i.test(relPath)) continue;
            if (!projectRoot) {
                invalid.push({ name: row.name, reason: '项目目录未绑定或无权限' });
                continue;
            }
            const ok = await this._assetPathExistsOnProjectRoot(projectRoot, relPath);
            if (!ok) invalid.push({ name: row.name, reason: '文件不存在或目录损坏' });
        }
        if (!invalid.length) {
            alert('检查完成：未发现失效资源。');
            return;
        }
        const preview = invalid
            .slice(0, 12)
            .map(x => `- ${x.name}（${x.reason}）`)
            .join('\n');
        const more = invalid.length > 12 ? `\n...另有 ${invalid.length - 12} 项` : '';
        const ok = confirm(
            `检测到 ${invalid.length} 项失效资源：\n${preview}${more}\n\n将执行：\n1) 从资源注册库移除\n2) 自动清空所有引用字段\n\n是否继续？`
        );
        if (!ok) return;
        let clearedRefs = 0;
        invalid.forEach(item => {
            clearedRefs += this._clearReferencesForRemovedAsset(type, item.name);
            AssetManager.removeAsset(type, item.name);
        });
        this.refreshAssetList(type);
        this.refreshCastList();
        if (this.currentSceneId) this.selectScene(this.currentSceneId);
        alert(`清理完成：移除 ${invalid.length} 项失效资源，清空引用 ${clearedRefs} 处。`);
    },

    addCastMember() {
        if (!this.projectData) return alert('请先加载项目');
        const id = 'cast_' + Date.now();
        this.projectData.characterRoster.push({
            id,
            name: '新人物',
            defaultExpression: 'neutral',
            expressions: {
                neutral: { spriteAsset: '' }
            }
        });
        this.activeCastId = id;
        this.refreshCastList();
    },

    refreshCastList() {
        const root = document.getElementById('cast-list');
        const picker = document.getElementById('cast-picker');
        const searchText = String(this.castSearchText || '').trim().toLowerCase();
        if (!root) return;
        if (!this.projectData) {
            root.innerHTML = '<p class="cast-empty">请先加载项目后再编辑人物预设。</p>';
            if (picker) picker.innerHTML = '<option value="">选择人物并打开预设…</option>';
            return;
        }
        if (!this.projectData.relationAttributes) this.projectData.relationAttributes = {};
        if (!Array.isArray(this.projectData.unifiedAttributes)) this.projectData.unifiedAttributes = [];
        root.innerHTML = '';
        const esc = t =>
            String(t ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const roster = this.projectData.characterRoster || [];
        if (picker) {
            picker.innerHTML = '<option value="">选择人物并打开预设…</option>';
            roster.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name || c.id;
                picker.appendChild(opt);
            });
            if (this.activeCastId && roster.some(c => c.id === this.activeCastId)) {
                picker.value = this.activeCastId;
            } else {
                this.activeCastId = '';
            }
        }
        const matched = roster.filter(c => {
            if (!searchText) return true;
            return String(c.name || '').toLowerCase().includes(searchText) || String(c.id || '').toLowerCase().includes(searchText);
        });
        const selected = this.activeCastId ? matched.filter(c => c.id === this.activeCastId) : matched.slice(0, 1);
        if (!selected.length) {
            root.innerHTML = '<p class="cast-empty">没有匹配人物，请调整搜索或新增人物。</p>';
            return;
        }

        selected.forEach(c => {
            const card = document.createElement('div');
            card.className = 'cast-card';
            const exprKeys = Object.keys(c.expressions || {});
            let exprRows = '';
            exprKeys.forEach(key => {
                const sprite = (c.expressions[key] && c.expressions[key].spriteAsset) || '';
                const spritePath =
                    sprite && typeof AssetManager !== 'undefined' && AssetManager.getPath
                        ? AssetManager.getPath('characters', sprite) || ''
                        : '';
                exprRows += `
                    <div class="cast-expr-row" data-key="${esc(key)}">
                        <input type="text" class="expr-key-inp" value="${esc(key)}" style="width:100px">
                        <button type="button" class="btn-upload-expr-spr">上传并绑定</button>
                        <div class="expr-sprite-preview ${spritePath ? 'is-bound' : 'is-empty'}">
                            ${
                                spritePath
                                    ? `<img class="expr-sprite-thumb" src="${esc(spritePath)}" alt="立绘预览">`
                                    : '<div class="expr-sprite-thumb-placeholder">未绑定</div>'
                            }
                        </div>
                        <span class="expr-bind-status">${spritePath ? '已绑定立绘' : '未绑定立绘'}</span>
                        <button type="button" class="btn-del-expr">删情绪</button>
                    </div>`;
            });
            card.innerHTML = `
                <div class="cast-card-head">
                    <strong>人物</strong>
                    <button type="button" class="btn-del-cast">删除人物</button>
                </div>
                <div class="form-item"><label>姓名</label><input type="text" class="cast-name-inp" value="${esc(c.name)}"></div>
                <div class="form-item"><label>内部 ID</label><input type="text" class="cast-id-inp" value="${esc(c.id)}" readonly style="opacity:0.8"></div>
                <div class="form-item"><label>默认情绪 key</label><input type="text" class="cast-default-expr" value="${esc(c.defaultExpression || 'neutral')}"></div>
                <div class="cast-expr-block"><h4>情绪 → 立绘（每图专属本角色）</h4>${exprRows}</div>
                <button type="button" class="btn-add-expr">+ 情绪</button>

                <div class="form-section" style="margin-top:14px">
                    <h4 style="margin:0 0 10px">关系好感度（本角色 → 其他角色）</h4>
                    <div class="step-row" style="grid-template-columns: 180px 120px 1fr;">
                        <select class="rel-target-sel"></select>
                        <input class="rel-init-inp" type="number" min="0" max="100" step="1" value="0">
                        <button type="button" class="btn-add-rel mini-btn">增加好感度属性</button>
                    </div>
                    <div class="rel-list" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"></div>
                </div>

                <div class="form-section" style="margin-top:14px">
                    <h4 style="margin:0 0 10px">统一属性（覆盖本角色初始值）</h4>
                    <div class="step-row" style="grid-template-columns: 200px 1fr 120px;">
                        <select class="uni-key-sel"></select>
                        <input class="uni-val-inp" type="text" placeholder="数值或 是/否">
                        <button type="button" class="btn-save-uni mini-btn">保存覆盖</button>
                    </div>
                    <div class="uni-hint" style="color:#888;font-size:12px;margin-top:8px">系统保留统一属性「存在」可在剧情里改为否/是。</div>
                </div>
            `;

            card.querySelector('.cast-name-inp').oninput = e => {
                c.name = e.target.value;
                if (this.currentSceneId) this.updateDropdowns(this.getScene(this.currentSceneId));
            };
            card.querySelector('.cast-default-expr').oninput = e => {
                c.defaultExpression = e.target.value;
            };
            card.querySelector('.btn-del-cast').onclick = () => {
                if (!confirm('确定删除该人物及其情绪绑定？')) return;
                const idx = this.projectData.characterRoster.findIndex(x => x.id === c.id);
                if (idx >= 0) this.projectData.characterRoster.splice(idx, 1);
                if (this.activeCastId === c.id) this.activeCastId = '';
                this.refreshCastList();
                if (this.currentSceneId) this.selectScene(this.currentSceneId);
            };
            card.querySelector('.btn-add-expr').onclick = () => {
                const raw = prompt('请输入情绪 key（例如 neutral / happy / angry）', '');
                if (raw === null) return;
                const nk = raw.trim();
                if (!nk) {
                    alert('情绪 key 不能为空。');
                    return;
                }
                if (c.expressions[nk]) {
                    alert('该情绪 key 已存在，请换一个。');
                    return;
                }
                c.expressions[nk] = { spriteAsset: '' };
                this.refreshCastList();
            };

            card.querySelectorAll('.cast-expr-row').forEach(row => {
                const oldKey = row.dataset.key;
                const keyInp = row.querySelector('.expr-key-inp');
                keyInp.onchange = () => {
                    const nk = keyInp.value.trim();
                    if (!nk || nk === oldKey) return;
                    c.expressions[nk] = c.expressions[oldKey] || { spriteAsset: '' };
                    delete c.expressions[oldKey];
                    row.dataset.key = nk;
                };
                row.querySelector('.btn-upload-expr-spr').onclick = async () => {
                    const exprKey = keyInp.value.trim() || row.dataset.key;
                    await Editor.uploadAndBindExpressionSprite(c, exprKey);
                    this.refreshCastList();
                    if (this.currentSceneId) this.refreshVisualDirector();
                };
                row.querySelector('.btn-del-expr').onclick = () => {
                    const k = (keyInp.value && keyInp.value.trim()) || row.dataset.key;
                    delete c.expressions[k];
                    this.refreshCastList();
                };
            });

            // 关系好感度 UI（本角色 -> 目标角色）
            const relMap = (this.projectData.relationAttributes[c.id] =
                this.projectData.relationAttributes[c.id] && typeof this.projectData.relationAttributes[c.id] === 'object'
                    ? this.projectData.relationAttributes[c.id]
                    : {});
            const relTargetSel = card.querySelector('.rel-target-sel');
            const relInitInp = card.querySelector('.rel-init-inp');
            const relList = card.querySelector('.rel-list');
            const renderRelList = () => {
                relList.innerHTML = '';
                Object.keys(relMap).forEach(tid => {
                    const tChar = (this.projectData.characterRoster || []).find(x => x.id === tid);
                    const name = (tChar && tChar.name) || tid;
                    const v = relMap[tid] && relMap[tid].affection != null ? relMap[tid].affection : 0;
                    const row = document.createElement('div');
                    row.style.display = 'grid';
                    row.style.gridTemplateColumns = '1fr 90px 70px';
                    row.style.gap = '8px';
                    const lab = document.createElement('div');
                    lab.textContent = `人物：${c.name || c.id} · 好感对象：${name}`;
                    const val = document.createElement('input');
                    val.type = 'number';
                    val.min = '0';
                    val.max = '100';
                    val.step = '1';
                    val.value = v;
                    val.oninput = () => {
                        const n = Math.max(0, Math.min(100, Math.round(Number(val.value) || 0)));
                        relMap[tid] = { affection: n };
                    };
                    const del = document.createElement('button');
                    del.className = 'mini-btn';
                    del.textContent = '删除';
                    del.onclick = () => {
                        delete relMap[tid];
                        renderRelList();
                    };
                    row.appendChild(lab);
                    row.appendChild(val);
                    row.appendChild(del);
                    relList.appendChild(row);
                });
            };
            if (relTargetSel) {
                relTargetSel.innerHTML = '<option value="">选择目标角色…</option>';
                (this.projectData.characterRoster || [])
                    .filter(x => x.id && x.id !== c.id)
                    .forEach(x => {
                        const opt = document.createElement('option');
                        opt.value = x.id;
                        opt.textContent = x.name || x.id;
                        relTargetSel.appendChild(opt);
                    });
            }
            const btnAddRel = card.querySelector('.btn-add-rel');
            if (btnAddRel) {
                btnAddRel.onclick = () => {
                    const tid = relTargetSel && relTargetSel.value;
                    if (!tid) return alert('请选择目标角色');
                    if (tid === c.id) return alert('不允许自指');
                    if (relMap[tid]) return alert('该目标角色已存在好感度属性');
                    const init = Math.max(0, Math.min(100, Math.round(Number(relInitInp && relInitInp.value) || 0)));
                    relMap[tid] = { affection: init };
                    renderRelList();
                };
            }
            renderRelList();

            // 统一属性覆盖 UI
            if (!c.unifiedOverrides || typeof c.unifiedOverrides !== 'object') c.unifiedOverrides = {};
            const uniKeySel = card.querySelector('.uni-key-sel');
            const uniValInp = card.querySelector('.uni-val-inp');
            const btnSaveUni = card.querySelector('.btn-save-uni');
            const defs = this.projectData.unifiedAttributes || [];
            const keys = ['存在', ...defs.map(d => d && d.key).filter(Boolean)];
            if (uniKeySel) {
                uniKeySel.innerHTML = keys.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
                uniKeySel.onchange = () => {
                    const k = uniKeySel.value;
                    const def = k === '存在' ? true : (defs.find(d => d.key === k) || {}).default;
                    const cur = c.unifiedOverrides[k] != null ? c.unifiedOverrides[k] : def;
                    uniValInp.value = typeof cur === 'boolean' ? (cur ? '是' : '否') : String(cur ?? '');
                };
                uniKeySel.dispatchEvent(new Event('change'));
            }
            if (btnSaveUni) {
                btnSaveUni.onclick = () => {
                    const k = uniKeySel.value;
                    if (!k) return;
                    const defRow = defs.find(d => d.key === k);
                    const isBool = k === '存在' || (defRow && defRow.type === 'bool');
                    if (isBool) {
                        const raw = String(uniValInp.value || '').trim();
                        const v = raw === '是' || raw === 'true' || raw === '1';
                        c.unifiedOverrides[k] = v;
                    } else {
                        c.unifiedOverrides[k] = Number(uniValInp.value) || 0;
                    }
                    // 静默保存
                };
            }

            root.appendChild(card);
        });
    },

    refreshSceneList() {
        const list = document.getElementById('scene-list');
        list.innerHTML = '';
        const kw = String(this.sceneSearchText || '').trim().toLowerCase();
        this.projectData.scenes.forEach(s => {
            if (kw) {
                const text = `${s.name || ''} ${s.id || ''}`.toLowerCase();
                if (!text.includes(kw)) return;
            }
            const div = document.createElement('div');
            div.className = 'scene-item';
            if (this.currentSceneId === s.id) div.classList.add('active');
            div.innerText = s.name || s.id;
            div.onclick = () => {
                document.querySelectorAll('.scene-item').forEach(i => i.classList.remove('active'));
                div.classList.add('active');
                this.selectScene(s.id);
            };
            list.appendChild(div);
        });
        this.fillStepsPageSceneSelect();
    },

    selectScene(id) {
        this.currentSceneId = id;
        const scene = this.getScene(id);
        document.getElementById('editor-content').querySelector('.empty-msg').style.display = 'none';
        document.getElementById('editor-form').style.display = 'block';

        document.getElementById('edit-name').value = scene.name || '';
        document.getElementById('edit-id').value = scene.id;
        document.getElementById('edit-text').value = scene.text;
        const bg = LayoutHelpers.normalizeBackground(scene.background || {});
        document.getElementById('edit-bg-url').value = scene.background.url || '';
        document.getElementById('edit-bg-fit-pan-x').value = bg.fitPanX;
        document.getElementById('edit-bg-fit-pan-y').value = bg.fitPanY;
        document.getElementById('edit-bg-fit-zoom').value = bg.fitZoom;
        const lay = LayoutHelpers.normalizeCharacterLayout(scene.character);
        const lx = document.getElementById('edit-char-layout-pan-x');
        const ly = document.getElementById('edit-char-layout-pan-y');
        const lz = document.getElementById('edit-char-layout-zoom');
        if (lx) lx.value = lay.panX;
        if (ly) ly.value = lay.panY;
        if (lz) lz.value = lay.zoom;
        scene.characterName = this.getSceneSpeakerName(scene);

        this.updateStoryCgLabel(scene);
        if (typeof StoryEffectsRegistry !== 'undefined') {
            const ef = StoryEffectsRegistry.normalizeEffects(scene.effects);
            const ent = document.getElementById('edit-fx-entrance');
            const cb = document.getElementById('edit-fx-combo');
            const dr = document.getElementById('edit-fx-dramatic');
            const ovs = document.getElementById('edit-fx-overlays');
            if (ent) ent.value = ef.cgEntrance || '';
            if (cb) cb.value = ef.combo || '';
            if (dr) dr.value = ef.dramatic || '';
            if (ovs) {
                Array.from(ovs.options).forEach(opt => {
                    opt.selected = ef.overlays.includes(opt.value);
                });
            }
            this.updateFxComboLock();
        }
        this.updateDropdowns(scene);
        this.fillStepsPageSceneSelect();
        this.updateStepsPageSubtitle();
        this.renderSteps();
        this.refreshVisualDirector();
    },

    /** 全局标签列表（显示用：场景名_后缀；内部：sceneId + '_' + suffix） */
    collectAllLabels(scopeSceneId = '') {
        const out = [];
        (this.projectData.scenes || []).forEach(sc => {
            if (scopeSceneId && sc.id !== scopeSceneId) return;
            (sc.steps || []).forEach(st => {
                if (st && st.labelSuffix) {
                    out.push({
                        sceneId: sc.id,
                        sceneName: sc.name || sc.id,
                        suffix: st.labelSuffix,
                        display: `${sc.name || sc.id}_${st.labelSuffix}`
                    });
                }
            });
        });
        return out;
    },

    /** 某场景内入口标签下拉：首项为从场景开头，其后为该场景各步骤的 labelSuffix */
    collectLabelsForScene(sceneId) {
        const rows = [{ suffix: '', label: '从场景开头' }];
        const sc = (this.projectData.scenes || []).find(x => x.id === sceneId);
        if (!sc) return rows;
        (sc.steps || []).forEach(st => {
            if (st && st.labelSuffix) {
                rows.push({
                    suffix: st.labelSuffix,
                    label: `${sc.name || sc.id}_${st.labelSuffix}`
                });
            }
        });
        return rows;
    },

    setLabelSearchScope(v) {
        this.labelSearchScope = v || 'global';
        ['label-search-scope', 'label-search-scope-page'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = this.labelSearchScope;
        });
    },

    setLabelSearchInputValue(v) {
        this.labelSearchText = (v || '').trim();
        ['label-search-input', 'label-search-input-page'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = this.labelSearchText;
        });
    },

    fillStepsPageSceneSelect() {
        const sel = document.getElementById('steps-page-scene-select');
        if (!sel) return;
        sel.innerHTML = '';
        (this.projectData.scenes || []).forEach(s => {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = s.name || s.id;
            sel.appendChild(o);
        });
        if (this.currentSceneId) sel.value = this.currentSceneId;
    },

    updateStepsPageSubtitle() {
        const sub = document.getElementById('steps-page-subtitle');
        if (!sub) return;
        sub.textContent = '';
    },

    openStepsEditorPage() {
        if (!this.currentSceneId) return;
        this.stepsPageVisible = true;
        const tb = document.getElementById('toolbar');
        if (tb) tb.style.display = 'none';
        const vs = document.getElementById('view-steps');
        const vstory = document.getElementById('view-story');
        const vcast = document.getElementById('view-cast');
        const vassets = document.getElementById('view-assets');
        if (vs) vs.style.display = 'block';
        if (vstory) vstory.style.display = 'none';
        if (vcast) vcast.style.display = 'none';
        if (vassets) vassets.style.display = 'none';
        this.setLabelSearchScope(this.labelSearchScope);
        this.setLabelSearchInputValue(this.labelSearchText);
        this.fillStepsPageSceneSelect();
        this.updateStepsPageSubtitle();
        this.renderSteps();
    },

    closeStepsEditorPage() {
        this.stepsPageVisible = false;
        const tb = document.getElementById('toolbar');
        if (tb) tb.style.display = 'flex';
        const vs = document.getElementById('view-steps');
        const vstory = document.getElementById('view-story');
        if (vs) vs.style.display = 'none';
        if (vstory) vstory.style.display = 'flex';
        this.renderSteps();
    },

    _wireLabelQuickPickHandlers() {
        ['label-quick-pick', 'label-quick-pick-page'].forEach(selectId => {
            const labelQuickPick = document.getElementById(selectId);
            if (!labelQuickPick) return;
            labelQuickPick.onchange = () => {
                const val = (labelQuickPick.value || '').trim();
                if (!val) return;
                const suffix = val.includes('_') ? val.split('_').slice(1).join('_') : val;
                const scene = this.getScene(this.currentSceneId);
                const idx = (scene && scene.steps ? scene.steps : []).findIndex(s => s && s.labelSuffix === suffix);
                if (idx < 0) return;
                const card = document.querySelectorAll('.step-card')[idx];
                if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
        });
    },

    refreshGlobalLabelsDatalist() {
        const dl = document.getElementById('global-labels');
        if (!dl) return;
        dl.innerHTML = '';
        const onlyCurrent = this.labelSearchScope === 'scene';
        const sceneId = onlyCurrent ? this.currentSceneId : '';
        const labels = this.collectAllLabels(sceneId);
        labels.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.display;
            dl.appendChild(opt);
        });
        const optsHtml =
            '<option value="">标签下拉菜单</option>' + labels.map(l => `<option value="${l.display}">${l.display}</option>`).join('');
        ['label-quick-pick', 'label-quick-pick-page'].forEach(id => {
            const quickPick = document.getElementById(id);
            if (quickPick) quickPick.innerHTML = optsHtml;
        });
        this._wireLabelQuickPickHandlers();
    },

    getStepTypeLabel(type) {
        const map = { dialogue: '对白', narration: '旁白', cg: 'CG', choice: '选项', random: '随机' };
        return map[type] || type || '对白';
    },

    renderSteps() {
        if (!this.currentSceneId) return;
        const scene = this.getScene(this.currentSceneId);
        if (!scene) return;
        this.refreshGlobalLabelsDatalist();

        const inlineRoot = document.getElementById('steps-list');
        const pageRoot = document.getElementById('steps-list-page');
        const root = this.stepsPageVisible ? pageRoot : inlineRoot;
        if (!root) return;
        root.innerHTML = '';

        // DnD：拖拽排序
        let dragIndex = -1;
        const clearDropMarks = () => {
            root.querySelectorAll('.step-card.drop-target').forEach(el => el.classList.remove('drop-target'));
        };
        const moveStep = (from, to) => {
            if (from < 0 || to < 0) return;
            if (from === to) return;
            const list = scene.steps;
            if (!list || from >= list.length || to >= list.length) return;
            const [it] = list.splice(from, 1);
            list.splice(to, 0, it);
        };

        const roster = this.projectData.characterRoster || [];

        const makeHead = (step, idx) => {
            const head = document.createElement('div');
            head.className = 'step-card-head';
            head.style.flexWrap = 'wrap';
            head.style.alignItems = 'center';
            head.style.justifyContent = 'space-between';
            head.style.gap = '8px';

            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.flexWrap = 'wrap';
            left.style.alignItems = 'center';
            left.style.gap = '8px';
            left.style.flex = '1';
            left.style.minWidth = '0';
            const handle = document.createElement('span');
            handle.className = 'drag-handle';
            handle.textContent = step.type === 'cg' ? '拖拽 #CG' : '⇅ 拖拽';
            handle.setAttribute('draggable', 'true');
            handle.title = '按住此处拖拽排序';
            const title = document.createElement('span');
            title.className = 'step-title';
            title.textContent = `#${idx + 1} · ${this.getStepTypeLabel(step.type)}`;
            left.appendChild(handle);
            left.appendChild(title);

            const btnSetTag = document.createElement('button');
            btnSetTag.className = 'mini-btn';
            btnSetTag.textContent = step.labelSuffix ? `标签：${(scene.name || scene.id)}_${step.labelSuffix}` : '设定标签';
            btnSetTag.onclick = () => {
                const suffix = prompt('请输入中文标签名（例如：哭泣）', step.labelSuffix || '');
                if (suffix === null) return;
                const s = suffix.trim();
                if (!s) {
                    step.labelSuffix = '';
                    this.renderSteps();
                    return;
                }
                const exists = (scene.steps || []).some((x, i) => i !== idx && x && x.labelSuffix === s);
                if (exists) {
                    alert('本场景已有相同标签名，请重新输入。');
                    return;
                }
                step.labelSuffix = s;
                this.renderSteps();
            };
            const btnCancelTag = document.createElement('button');
            btnCancelTag.className = 'mini-btn';
            btnCancelTag.textContent = '取消标签';
            btnCancelTag.onclick = () => {
                if (!step.labelSuffix) return;
                if (!confirm('确定要取消本步骤的入口标签吗？取消后本步骤不再带有标签。')) return;
                step.labelSuffix = '';
                this.renderSteps();
            };
            left.appendChild(btnSetTag);
            left.appendChild(btnCancelTag);
            if (step.type === 'cg') {
                const btnHideDlg = document.createElement('button');
                btnHideDlg.className = 'mini-btn';
                const syncHideDlg = () => {
                    const on = step.hideDialogue !== false;
                    btnHideDlg.textContent = on ? '对话框消失' : '对话框显示';
                    btnHideDlg.classList.toggle('is-on', on);
                };
                btnHideDlg.onclick = () => {
                    step.hideDialogue = !(step.hideDialogue !== false);
                    syncHideDlg();
                };
                syncHideDlg();
                left.appendChild(btnHideDlg);

                const btnHideChar = document.createElement('button');
                btnHideChar.className = 'mini-btn';
                const syncHideChar = () => {
                    const on = step.hideCharacter !== false;
                    btnHideChar.textContent = on ? '显示时隐藏立绘' : '显示时保留立绘';
                    btnHideChar.classList.toggle('is-on', on);
                };
                btnHideChar.onclick = () => {
                    step.hideCharacter = !(step.hideCharacter !== false);
                    syncHideChar();
                };
                syncHideChar();
                left.appendChild(btnHideChar);
            }

            if (step.type === 'choice') {
                const addOpt = document.createElement('button');
                addOpt.className = 'mini-btn';
                addOpt.textContent = '增加选项';
                addOpt.onclick = () => {
                    const os = Array.isArray(step.options) ? step.options : (step.options = []);
                    os.push({
                        text: '新选项',
                        next: { type: 'scene', sceneId: scene.id, labelSuffix: '' },
                        effects: [],
                        condition: null
                    });
                    this.renderSteps();
                };
                left.appendChild(addOpt);
            }
            if (step.type === 'random') {
                const addR = document.createElement('button');
                addR.className = 'mini-btn';
                addR.textContent = '增加结果行';
                addR.onclick = () => {
                    const tbl = Array.isArray(step.table) ? step.table : (step.table = []);
                    tbl.push({
                        name: '新结果',
                        weight: 10,
                        next: { type: 'scene', sceneId: scene.id, labelSuffix: '' },
                        condition: null,
                        effects: []
                    });
                    this.renderSteps();
                };
                left.appendChild(addR);
            }

            const actions = document.createElement('div');
            actions.className = 'step-actions';

            const onDragStart = ev => {
                dragIndex = idx;
                ev.dataTransfer.effectAllowed = 'move';
                try {
                    ev.dataTransfer.setData('text/plain', String(step.id || idx));
                } catch {}
                const card = head.closest('.step-card');
                if (card) card.classList.add('dragging');
            };
            const onDragEnd = () => {
                dragIndex = -1;
                clearDropMarks();
                root.querySelectorAll('.step-card.dragging').forEach(el => el.classList.remove('dragging'));
            };
            handle.addEventListener('dragstart', onDragStart);
            handle.addEventListener('dragend', onDragEnd);

            const btnDel = document.createElement('button');
            btnDel.className = 'mini-btn';
            btnDel.textContent = '删除';
            btnDel.onclick = () => {
                scene.steps.splice(idx, 1);
                this.renderSteps();
            };

            const btnFx = document.createElement('button');
            btnFx.className = 'mini-btn';
            btnFx.textContent = '特效音效';
            btnFx.onclick = ev => {
                ev.preventDefault();
                ev.stopPropagation();
                this.openStepFxModal(step, idx + 1);
            };

            actions.appendChild(btnFx);
            actions.appendChild(btnDel);

            head.appendChild(left);
            head.appendChild(actions);
            return head;
        };

        const kw = (this.labelSearchText || '').trim();
        const renderedSteps = (scene.steps || []).map((s, i) => ({ s, i })).filter(({ s }) => {
            if (!kw) return true;
            const labelText = s && s.labelSuffix ? `${scene.name || scene.id}_${s.labelSuffix}` : '';
            return labelText.includes(kw);
        });
        renderedSteps.forEach(({ s: step, i: idx }) => {
            const card = document.createElement('div');
            card.className = 'step-card';
            card.dataset.stepId = step.id;
            card.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                clearDropMarks();
                card.classList.add('drop-target');
            });
            card.addEventListener('dragleave', () => {
                card.classList.remove('drop-target');
            });
            card.addEventListener('drop', (ev) => {
                ev.preventDefault();
                card.classList.remove('drop-target');
                const to = idx;
                if (dragIndex >= 0) {
                    // 由于 renderSteps 会重建 DOM，这里先做一次安全的 to 校正
                    const from = dragIndex;
                    const dest = from < to ? Math.max(0, to - 1) : to;
                    moveStep(from, dest);
                    this.renderSteps();
                }
            });
            card.appendChild(makeHead(step, idx));

            if (step.type === 'dialogue') {
                const rowDlg = document.createElement('div');
                rowDlg.className = 'step-dialogue-one-row';

                const grpSp = document.createElement('div');
                grpSp.className = 'step-dialogue-group';
                grpSp.appendChild(Object.assign(document.createElement('span'), { className: 'step-dialogue-mini-label', textContent: '说话人' }));
                const sel = document.createElement('select');
                sel.className = 'step-dialogue-select';
                sel.innerHTML = `<option value=\"\">（不显示立绘/不显示名字）</option>` + roster.map(c => `<option value=\"${c.id}\">${c.name || c.id}</option>`).join('');
                sel.value = step.speakerRef || '';
                sel.onchange = () => {
                    step.speakerRef = sel.value;
                    if (!step.speakerRef) step.expression = '';
                    if (typeof fillExprOptions === 'function') fillExprOptions();
                    this.refreshVisualDirector();
                };
                grpSp.appendChild(sel);

                const grpExpr = document.createElement('div');
                grpExpr.className = 'step-dialogue-group';
                grpExpr.appendChild(Object.assign(document.createElement('span'), { className: 'step-dialogue-mini-label', textContent: '立绘' }));
                const exprSel = document.createElement('select');
                exprSel.className = 'step-dialogue-select';
                const fillExprOptions = () => {
                    const char = (this.projectData.characterRoster || []).find(c => c.id === (step.speakerRef || ''));
                    const keys = char ? Object.keys(char.expressions || {}) : [];
                    exprSel.innerHTML = '<option value="">选择立绘</option>' + keys.map(k => `<option value="${k}">${k}</option>`).join('');
                    if (!keys.includes(step.expression || '')) step.expression = keys[0] || '';
                    exprSel.value = step.expression || '';
                };
                fillExprOptions();
                exprSel.onchange = () => {
                    step.expression = exprSel.value || '';
                    this.refreshVisualDirector();
                };
                const modeSel = document.createElement('select');
                modeSel.className = 'step-dialogue-select';
                modeSel.innerHTML = `<option value=\"big\">大图</option><option value=\"small\">小图</option>`;
                modeSel.value = step.charMode || 'big';
                modeSel.onchange = () => (step.charMode = modeSel.value);
                const mirrorCb = document.createElement('input');
                mirrorCb.type = 'checkbox';
                mirrorCb.checked = !!step.mirror;
                mirrorCb.onchange = () => (step.mirror = mirrorCb.checked);
                const mLabel = document.createElement('label');
                mLabel.style.display = 'flex';
                mLabel.style.alignItems = 'center';
                mLabel.style.gap = '6px';
                mLabel.style.whiteSpace = 'nowrap';
                mLabel.appendChild(mirrorCb);
                mLabel.appendChild(document.createTextNode('镜像'));
                const uploadExprBtn = document.createElement('button');
                uploadExprBtn.className = 'mini-btn';
                uploadExprBtn.textContent = '上传';
                uploadExprBtn.onclick = async () => {
                    await this.uploadExpressionFromStep(step);
                    fillExprOptions();
                    this.refreshVisualDirector();
                };
                grpExpr.appendChild(modeSel);
                grpExpr.appendChild(mLabel);
                grpExpr.appendChild(exprSel);
                grpExpr.appendChild(uploadExprBtn);

                const grpPos = document.createElement('div');
                grpPos.className = 'step-dialogue-group';
                grpPos.appendChild(Object.assign(document.createElement('span'), { className: 'step-dialogue-mini-label', textContent: '立绘位置' }));
                const posBtn = document.createElement('button');
                posBtn.className = 'mini-btn';
                posBtn.textContent = '编辑位置…';
                posBtn.onclick = () => this.openDialogueCharLayoutModal(step, scene);
                grpPos.appendChild(posBtn);

                rowDlg.appendChild(grpSp);
                rowDlg.appendChild(grpExpr);
                rowDlg.appendChild(grpPos);
                card.appendChild(rowDlg);

                // 台词
                const ta = document.createElement('textarea');
                ta.className = 'step-textarea-3l';
                ta.value = step.text || '';
                ta.oninput = () => {
                    step.text = ta.value;
                };
                const rowText = document.createElement('div');
                rowText.className = 'step-row';
                rowText.innerHTML = `<label class=\"full\"></label>`;
                rowText.appendChild(ta);
                rowText.children[1].classList.add('full');
                card.appendChild(rowText);
            } else if (step.type === 'narration') {
                const ta = document.createElement('textarea');
                ta.className = 'step-textarea-3l';
                ta.value = step.text || '';
                ta.oninput = () => (step.text = ta.value);
                const rowText = document.createElement('div');
                rowText.className = 'step-row';
                rowText.innerHTML = `<label class=\"full\"></label>`;
                rowText.appendChild(ta);
                rowText.children[1].classList.add('full');
                card.appendChild(rowText);
            } else if (step.type === 'cg') {
                const cgIdxInScene = (scene.steps || []).findIndex(s => s && s.id === step.id);
                const buildStopSelect = fieldKey => {
                    const sel = document.createElement('select');
                    const opts = ['<option value="">选择在第几步停止</option>'];
                    if (cgIdxInScene >= 0) {
                        for (let fi = cgIdxInScene + 1; fi < (scene.steps || []).length; fi++) {
                            const st = scene.steps[fi];
                            if (!st) continue;
                            opts.push(`<option value="${st.id}">#${fi + 1} ${this.getStepTypeLabel(st.type || 'dialogue')}</option>`);
                        }
                    }
                    sel.innerHTML = opts.join('');
                    sel.value = step[fieldKey] || '';
                    sel.onchange = () => (step[fieldKey] = sel.value || '');
                    return sel;
                };

                const rowMedia = document.createElement('div');
                rowMedia.className = 'step-row';
                rowMedia.style.display = 'flex';
                rowMedia.style.flexWrap = 'nowrap';
                rowMedia.style.gap = '6px';
                rowMedia.style.alignItems = 'center';
                rowMedia.style.overflowX = 'auto';
                rowMedia.appendChild(Object.assign(document.createElement('label'), { textContent: 'CG 媒体' }));
                const libSel = document.createElement('select');
                libSel.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: '选择素材' }));
                libSel.appendChild(Object.assign(document.createElement('option'), { value: '__none__', textContent: '无' }));
                AssetManager.getList('storyGraphics').forEach(n => {
                    const o = document.createElement('option');
                    o.value = n;
                    o.textContent = n;
                    libSel.appendChild(o);
                });
                const hasEmbedOnly = step.cg && step.cg.embeddedDataUrl && !step.cg.url;
                if (hasEmbedOnly) {
                    const em = document.createElement('option');
                    em.value = '__embedded__';
                    em.textContent = '已嵌入';
                    libSel.appendChild(em);
                    libSel.value = '__embedded__';
                } else {
                    libSel.value = (step.cg && step.cg.url) || '';
                }
                libSel.onchange = () => {
                    const v = libSel.value;
                    if (v === '__none__') {
                        step.cg = {};
                        return this.renderSteps();
                    }
                    if (v === '__embedded__' || !v) return;
                    const path = (AssetManager.getPath && AssetManager.getPath('storyGraphics', v)) || v;
                    step.cg = { url: v, mediaType: this.inferCgMediaType(path) };
                    this.renderSteps();
                };
                const pickBtn = document.createElement('button');
                pickBtn.className = 'mini-btn';
                pickBtn.textContent = '上传';
                pickBtn.onclick = async () => {
                    const result = await this.pickAndRegisterAsset('storyGraphics', `step-cg-${scene.id}-${step.id}`, { allowVideo: true });
                    if (!result) return;
                    const mediaType = result.file.type.startsWith('video/') ? 'video' : 'image';
                    step.cg = { url: result.alias, fileName: result.file.name, mediaType };
                    this.renderSteps();
                };
                const btnVideoLoop = document.createElement('button');
                btnVideoLoop.className = 'mini-btn';
                const syncVideoLoop = () => {
                    const on = step.cgLoop !== false;
                    btnVideoLoop.textContent = '视频循环';
                    btnVideoLoop.classList.toggle('is-on', on);
                };
                btnVideoLoop.onclick = () => {
                    step.cgLoop = !(step.cgLoop !== false);
                    syncVideoLoop();
                };
                syncVideoLoop();
                rowMedia.appendChild(libSel);
                rowMedia.appendChild(pickBtn);
                rowMedia.appendChild(btnVideoLoop);
                rowMedia.appendChild(Object.assign(document.createElement('label'), { textContent: '停止 CG 画面' }));
                rowMedia.appendChild(buildStopSelect('cgStopAtStepId'));
                card.appendChild(rowMedia);

                const rowMusic = document.createElement('div');
                rowMusic.className = 'step-row';
                rowMusic.style.display = 'flex';
                rowMusic.style.flexWrap = 'nowrap';
                rowMusic.style.gap = '6px';
                rowMusic.style.alignItems = 'center';
                rowMusic.style.overflowX = 'auto';
                rowMusic.appendChild(Object.assign(document.createElement('label'), { textContent: 'CG音乐' }));
                const musSel = document.createElement('select');
                const musNames = (typeof AssetManager !== 'undefined' && AssetManager.getList ? AssetManager.getList('music') : []) || [];
                musSel.innerHTML =
                    `<option value="">选择音乐</option><option value="__none__">无</option>` +
                    musNames.map(x => `<option value="${x}">${x}</option>`).join('');
                musSel.value = step.cgMusicAlias || '';
                musSel.onchange = () => {
                    if (musSel.value === '__none__') step.cgMusicAlias = '';
                    else step.cgMusicAlias = musSel.value || '';
                };
                const btnMusUp = document.createElement('button');
                btnMusUp.className = 'mini-btn';
                btnMusUp.textContent = '上传';
                btnMusUp.onclick = async () => {
                    const result = await this.pickAndRegisterAsset('music', `step-cg-music-${scene.id}-${step.id}`);
                    if (!result) return;
                    step.cgMusicAlias = result.alias;
                    this.renderSteps();
                };
                const btnMusLoop = document.createElement('button');
                btnMusLoop.className = 'mini-btn';
                const syncMusLoop = () => {
                    const on = step.cgMusicLoop !== false;
                    btnMusLoop.textContent = '音乐循环';
                    btnMusLoop.classList.toggle('is-on', on);
                };
                btnMusLoop.onclick = () => {
                    step.cgMusicLoop = !(step.cgMusicLoop !== false);
                    syncMusLoop();
                };
                syncMusLoop();
                rowMusic.appendChild(musSel);
                rowMusic.appendChild(btnMusUp);
                rowMusic.appendChild(btnMusLoop);
                rowMusic.appendChild(Object.assign(document.createElement('label'), { textContent: '停止 CG 音乐' }));
                rowMusic.appendChild(buildStopSelect('cgMusicStopAtStepId'));
                card.appendChild(rowMusic);
            } else if (step.type === 'choice') {
                const opts = Array.isArray(step.options) ? step.options : (step.options = []);
                const defaultSid = (this.projectData.scenes[0] && this.projectData.scenes[0].id) || 'start';
                const normalizeSceneNext = (holder, keyNext) => {
                    const n = holder[keyNext] && typeof holder[keyNext] === 'object' ? holder[keyNext] : null;
                    if (!n) {
                        holder[keyNext] = { type: 'scene', sceneId: scene.id, labelSuffix: '' };
                        return;
                    }
                    if (n.type === 'scene' || n.type === 'ending') {
                        holder[keyNext] = {
                            type: 'scene',
                            sceneId: n.sceneId || defaultSid,
                            labelSuffix: n.labelSuffix || ''
                        };
                    } else if (n.type === 'label') {
                        holder[keyNext] = { type: 'scene', sceneId: scene.id, labelSuffix: n.labelSuffix || '' };
                    } else {
                        holder[keyNext] = { type: 'scene', sceneId: scene.id, labelSuffix: '' };
                    }
                };
                opts.forEach(o => {
                    normalizeSceneNext(o, 'next');
                    if (!Array.isArray(o.effects)) o.effects = [];
                });

                const fullRow = document.createElement('div');
                fullRow.className = 'step-row';
                fullRow.innerHTML = `<label class=\"full\">选项列表</label>`;
                const box = document.createElement('div');
                box.className = 'full';
                box.style.display = 'flex';
                box.style.flexDirection = 'column';
                box.style.gap = '10px';

                const sceneOptionsHtml = (this.projectData.scenes || [])
                    .map(s => `<option value=\"${s.id}\">${s.name || s.id}</option>`)
                    .join('');

                opts.forEach((o, oi) => {
                    normalizeSceneNext(o, 'next');
                    const line = document.createElement('div');
                    line.style.display = 'grid';
                    line.style.gridTemplateColumns = 'minmax(100px, 1.2fr) 52px 52px minmax(100px, 1fr) minmax(120px, 1fr) 40px';
                    line.style.gap = '8px';
                    line.style.alignItems = 'center';

                    const inp = document.createElement('input');
                    inp.value = o.text || '';
                    inp.placeholder = '选项文本';
                    inp.oninput = () => (o.text = inp.value);

                    const condBtn = document.createElement('button');
                    condBtn.className = 'mini-btn';
                    condBtn.textContent = o.condition ? '条件✓' : '条件';
                    condBtn.onclick = () => {
                        this.openRandomConditionModal(o, '选项显示条件');
                        setTimeout(() => this.renderSteps(), 0);
                    };

                    const fx = document.createElement('button');
                    fx.className = 'mini-btn';
                    fx.textContent = '属性';
                    fx.onclick = () => {
                        if (!Array.isArray(o.effects)) o.effects = [];
                        this.openEffectsModal(`选项「${o.text || '未命名'}」属性改动`, o.effects);
                    };

                    const selScene = document.createElement('select');
                    selScene.innerHTML = sceneOptionsHtml;
                    selScene.value = o.next.sceneId || defaultSid;
                    if (![...selScene.options].some(op => op.value === selScene.value)) {
                        const ox = document.createElement('option');
                        ox.value = o.next.sceneId;
                        ox.textContent = `${o.next.sceneId}（未列出）`;
                        selScene.appendChild(ox);
                        selScene.value = o.next.sceneId;
                    }

                    const selTag = document.createElement('select');
                    const fillTags = () => {
                        const sid = selScene.value || defaultSid;
                        const tags = this.collectLabelsForScene(sid);
                        const cur = o.next.labelSuffix || '';
                        selTag.innerHTML = '';
                        tags.forEach(t => {
                            const op = document.createElement('option');
                            op.value = t.suffix;
                            op.textContent = t.label;
                            selTag.appendChild(op);
                        });
                        const ok = tags.some(t => t.suffix === cur);
                        if (ok) selTag.value = cur;
                        else if (cur) {
                            const op = document.createElement('option');
                            op.value = cur;
                            op.textContent = `${cur}（目标场景无此标签）`;
                            selTag.appendChild(op);
                            selTag.value = cur;
                        } else selTag.value = '';
                    };
                    fillTags();
                    selScene.onchange = () => {
                        o.next.sceneId = selScene.value;
                        o.next.labelSuffix = '';
                        fillTags();
                    };
                    selTag.onchange = () => {
                        o.next.labelSuffix = selTag.value || '';
                    };

                    const del = document.createElement('button');
                    del.className = 'mini-btn';
                    del.textContent = '删';
                    del.onclick = () => {
                        opts.splice(oi, 1);
                        this.renderSteps();
                    };

                    line.appendChild(inp);
                    line.appendChild(condBtn);
                    line.appendChild(fx);
                    line.appendChild(selScene);
                    line.appendChild(selTag);
                    line.appendChild(del);
                    box.appendChild(line);
                });

                fullRow.appendChild(box);
                card.appendChild(fullRow);
            } else if (step.type === 'random') {
                const tbl = Array.isArray(step.table) ? step.table : (step.table = []);
                const defaultSid = (this.projectData.scenes[0] && this.projectData.scenes[0].id) || 'start';
                const normalizeSceneNext = holder => {
                    const n = holder.next && typeof holder.next === 'object' ? holder.next : null;
                    if (!n) {
                        holder.next = { type: 'scene', sceneId: scene.id, labelSuffix: '' };
                        return;
                    }
                    if (n.type === 'scene' || n.type === 'ending') {
                        holder.next = {
                            type: 'scene',
                            sceneId: n.sceneId || defaultSid,
                            labelSuffix: n.labelSuffix || ''
                        };
                    } else if (n.type === 'label') {
                        holder.next = { type: 'scene', sceneId: scene.id, labelSuffix: n.labelSuffix || '' };
                    } else {
                        holder.next = { type: 'scene', sceneId: scene.id, labelSuffix: '' };
                    }
                };
                tbl.forEach(r => {
                    normalizeSceneNext(r);
                    if (!Array.isArray(r.effects)) r.effects = [];
                });

                const fullRow = document.createElement('div');
                fullRow.className = 'step-row';
                fullRow.innerHTML = `<label class=\"full\">随机表（权重抽签；候选为空则结束）</label>`;
                const box = document.createElement('div');
                box.className = 'full';
                box.style.display = 'flex';
                box.style.flexDirection = 'column';
                box.style.gap = '10px';

                const sceneOptionsHtml = (this.projectData.scenes || [])
                    .map(s => `<option value=\"${s.id}\">${s.name || s.id}</option>`)
                    .join('');

                tbl.forEach((r, ri) => {
                    normalizeSceneNext(r);
                    const line = document.createElement('div');
                    line.style.display = 'grid';
                    line.style.gridTemplateColumns =
                        'minmax(72px, 1fr) 72px minmax(100px, 1fr) minmax(120px, 1.1fr) 52px 52px 40px';
                    line.style.gap = '8px';
                    line.style.alignItems = 'center';

                    const name = document.createElement('input');
                    name.value = r.name || '';
                    name.placeholder = '名称';
                    name.oninput = () => (r.name = name.value);

                    const w = document.createElement('input');
                    w.type = 'number';
                    w.value = r.weight != null ? r.weight : 0;
                    w.oninput = () => (r.weight = parseFloat(w.value) || 0);

                    const selScene = document.createElement('select');
                    selScene.innerHTML = sceneOptionsHtml;
                    selScene.value = r.next.sceneId || defaultSid;
                    if (![...selScene.options].some(op => op.value === selScene.value)) {
                        const ox = document.createElement('option');
                        ox.value = r.next.sceneId;
                        ox.textContent = `${r.next.sceneId}（未列出）`;
                        selScene.appendChild(ox);
                        selScene.value = r.next.sceneId;
                    }

                    const selTag = document.createElement('select');
                    const fillTags = () => {
                        const sid = selScene.value || defaultSid;
                        const tags = this.collectLabelsForScene(sid);
                        const cur = r.next.labelSuffix || '';
                        selTag.innerHTML = '';
                        tags.forEach(t => {
                            const op = document.createElement('option');
                            op.value = t.suffix;
                            op.textContent = t.label;
                            selTag.appendChild(op);
                        });
                        const ok = tags.some(t => t.suffix === cur);
                        if (ok) selTag.value = cur;
                        else if (cur) {
                            const op = document.createElement('option');
                            op.value = cur;
                            op.textContent = `${cur}（目标场景无此标签）`;
                            selTag.appendChild(op);
                            selTag.value = cur;
                        } else selTag.value = '';
                    };
                    fillTags();
                    selScene.onchange = () => {
                        r.next.sceneId = selScene.value;
                        r.next.labelSuffix = '';
                        fillTags();
                    };
                    selTag.onchange = () => {
                        r.next.labelSuffix = selTag.value || '';
                    };

                    const condBtn = document.createElement('button');
                    condBtn.className = 'mini-btn';
                    condBtn.textContent = r.condition ? '条件✓' : '条件';
                    condBtn.onclick = () => {
                        this.openRandomConditionModal(r);
                        setTimeout(() => this.renderSteps(), 0);
                    };

                    const fx = document.createElement('button');
                    fx.className = 'mini-btn';
                    fx.textContent = '属性';
                    fx.onclick = () => {
                        if (!Array.isArray(r.effects)) r.effects = [];
                        this.openEffectsModal(`随机结果「${r.name || '未命名'}」属性改动`, r.effects);
                    };

                    const del = document.createElement('button');
                    del.className = 'mini-btn';
                    del.textContent = '删';
                    del.onclick = () => {
                        tbl.splice(ri, 1);
                        this.renderSteps();
                    };

                    line.appendChild(name);
                    line.appendChild(w);
                    line.appendChild(selScene);
                    line.appendChild(selTag);
                    line.appendChild(condBtn);
                    line.appendChild(fx);
                    line.appendChild(del);
                    box.appendChild(line);
                });

                fullRow.appendChild(box);
                card.appendChild(fullRow);
            }

            const bottomActions = document.createElement('div');
            bottomActions.className = 'step-actions';
            bottomActions.style.justifyContent = 'flex-start';

            const btnAttr = document.createElement('button');
            btnAttr.className = 'mini-btn';
            btnAttr.textContent = '人物值';
            btnAttr.onclick = () => {
                if (!Array.isArray(step.effects)) step.effects = [];
                this.openEffectsModal(`步骤 #${idx + 1} 属性改动`, step.effects);
            };
            bottomActions.appendChild(btnAttr);

            if (step.type === 'dialogue' || step.type === 'narration' || step.type === 'random' || step.type === 'cg' || step.type === 'choice') {
                const btnCopySelf = document.createElement('button');
                btnCopySelf.className = 'mini-btn';
                btnCopySelf.textContent = '复制本步';
                btnCopySelf.onclick = () => {
                    const clone = JSON.parse(JSON.stringify(step));
                    clone.id = `step_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
                    clone.labelSuffix = '';
                    if (clone.type === 'dialogue' || clone.type === 'narration') clone.text = '';
                    clone.soundAlias = '';
                    scene.steps.splice(idx + 1, 0, clone);
                    this.renderSteps();
                    setTimeout(() => {
                        const el = document.querySelector(`[data-step-id="${clone.id}"] textarea`);
                        if (el) el.focus();
                    }, 0);
                };
                bottomActions.appendChild(btnCopySelf);
            }

            if (
                (step.type === 'dialogue' || step.type === 'narration' || step.type === 'random' || step.type === 'cg' || step.type === 'choice') &&
                idx > 0
            ) {
                const btnCopyPrev = document.createElement('button');
                btnCopyPrev.className = 'mini-btn';
                btnCopyPrev.textContent = '复制上步';
                btnCopyPrev.onclick = () => {
                    const prev = scene.steps[idx - 1];
                    if (!prev) return;
                    const clone = JSON.parse(JSON.stringify(prev));
                    clone.id = `step_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
                    clone.labelSuffix = '';
                    if (clone.type === 'dialogue' || clone.type === 'narration') clone.text = '';
                    clone.soundAlias = '';
                    scene.steps.splice(idx + 1, 0, clone);
                    this.renderSteps();
                };
                bottomActions.appendChild(btnCopyPrev);
            }

            ['dialogue', 'narration', 'cg', 'choice', 'random'].forEach(tp => {
                const b = document.createElement('button');
                b.className = 'mini-btn';
                b.textContent = `+${this.getStepTypeLabel(tp)}`;
                b.onclick = () => {
                    scene.steps.splice(idx + 1, 0, this._makeDefaultStep(tp));
                    this.renderSteps();
                };
                bottomActions.appendChild(b);
            });
            card.appendChild(bottomActions);

            root.appendChild(card);
        });
    },

    updateStoryCgLabel(scene) {
        const el = document.getElementById('story-cg-label');
        if (!el) return;
        const sg = scene.storyGraphic || {};
        if (sg.embeddedDataUrl) {
            el.textContent = `已嵌入本场景：${sg.fileName || '图片'}（已写入导出 JSON）`;
        } else if (sg.url) {
            el.textContent = `（旧版）使用资源库别名：${sg.url}`;
        } else {
            el.textContent = '';
        }
    },

    updateDropdowns(scene) {
        const legacySel = document.getElementById('edit-char-url-legacy');
        const bgDrop = document.getElementById('edit-bg-url');
        const musicDrop = document.getElementById('edit-music-url');
        const musicLoop = document.getElementById('edit-music-loop');

        scene.characterName = this.getSceneSpeakerName(scene);

        bgDrop.innerHTML = '<option value="">-- 选择背景 --</option>';
        AssetManager.getList('backgrounds').forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (scene.background.url === name) opt.selected = true;
            bgDrop.appendChild(opt);
        });
        bgDrop.onchange = e => {
            scene.background.url = e.target.value;
            this.refreshVisualDirector();
        };

        if (musicDrop) {
            musicDrop.innerHTML = '';
            const optNone = document.createElement('option');
            optNone.value = '';
            optNone.textContent = '（无背景音乐）';
            musicDrop.appendChild(optNone);
            AssetManager.getList('music').forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                musicDrop.appendChild(opt);
            });
            const cur = (scene.music && scene.music.url) || '';
            musicDrop.value = cur;
            if (cur && musicDrop.value !== cur) {
                const optOrphan = document.createElement('option');
                optOrphan.value = cur;
                optOrphan.textContent = `${cur}（未在库中，请重选或清除）`;
                musicDrop.appendChild(optOrphan);
                musicDrop.value = cur;
            }
            musicDrop.onchange = e => {
                scene.music = scene.music || {};
                scene.music.url = e.target.value || '';
            };
        }
        if (musicLoop) {
            musicLoop.checked = !scene.music || scene.music.loop !== false;
            musicLoop.onchange = () => {
                scene.music = scene.music || {};
                scene.music.loop = !!musicLoop.checked;
            };
        }

        if (legacySel) {
            legacySel.innerHTML = '<option value="">-- 无 --</option>';
            AssetManager.getList('characters').forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                if (scene.character && scene.character.url === name) opt.selected = true;
                legacySel.appendChild(opt);
            });
            legacySel.onchange = e => {
                scene.character = scene.character || { layout: { panX: 0, panY: 0, zoom: 1 } };
                scene.character.url = e.target.value;
                if (e.target.value) scene.characterRef = '';
                scene.characterName = this.getSceneSpeakerName(scene);
                this.syncLegacyRow(scene);
                this.refreshVisualDirector();
            };
        }

        this.syncLegacyRow(scene);
    },

    syncLegacyRow(scene) {
        const legacyRow = document.getElementById('legacy-char-row');
        const show = !!(scene.character && scene.character.url) && !scene.characterRef;
        legacyRow.style.display = show ? 'block' : 'none';
    },

    renderOptions() {
        const scene = this.getScene(this.currentSceneId);
        const container = document.getElementById('options-list');
        if (!container || !scene) return;
        container.innerHTML = '';
        scene.options.forEach((opt, index) => {
            const div = document.createElement('div');
            div.className = 'option-edit-item';
            const textInp = document.createElement('input');
            textInp.value = opt.text;
            textInp.oninput = e => {
                opt.text = e.target.value;
            };
            const targetSel = document.createElement('select');
            this.projectData.scenes.forEach(s => {
                const optTag = document.createElement('option');
                optTag.value = s.id;
                optTag.textContent = s.name || s.id;
                if (s.id === opt.target) optTag.selected = true;
                targetSel.appendChild(optTag);
            });
            targetSel.onchange = e => {
                opt.target = e.target.value;
            };
            const delBtn = document.createElement('button');
            delBtn.innerText = '删除';
            delBtn.onclick = () => {
                scene.options.splice(index, 1);
                this.renderOptions();
            };
            div.appendChild(textInp);
            div.appendChild(targetSel);
            div.appendChild(delBtn);
            container.appendChild(div);
        });
    },

    syncToData() {
        const scene = this.getScene(this.currentSceneId);
        scene.name = document.getElementById('edit-name').value;
        scene.text = document.getElementById('edit-text').value;
        scene.background = scene.background || {};
        scene.background.fitPanX = parseFloat(document.getElementById('edit-bg-fit-pan-x').value) || 0;
        scene.background.fitPanY = parseFloat(document.getElementById('edit-bg-fit-pan-y').value) || 0;
        scene.background.fitZoom = parseFloat(document.getElementById('edit-bg-fit-zoom').value) || 1;
        scene.character = scene.character || {};
        scene.character.layout = scene.character.layout || {};
        const lx = document.getElementById('edit-char-layout-pan-x');
        const ly = document.getElementById('edit-char-layout-pan-y');
        const lz = document.getElementById('edit-char-layout-zoom');
        if (lx) scene.character.layout.panX = parseFloat(lx.value) || 0;
        if (ly) scene.character.layout.panY = parseFloat(ly.value) || 0;
        if (lz) scene.character.layout.zoom = parseFloat(lz.value) || 1;
        scene.music = scene.music || {};
        const musicDrop = document.getElementById('edit-music-url');
        const musicLoop = document.getElementById('edit-music-loop');
        if (musicDrop) scene.music.url = musicDrop.value || '';
        if (musicLoop) scene.music.loop = !!musicLoop.checked;
        scene.characterName = this.getSceneSpeakerName(scene);
        if (typeof StoryEffectsRegistry !== 'undefined') {
            const ovsEl = document.getElementById('edit-fx-overlays');
            scene.effects = StoryEffectsRegistry.normalizeEffects({
                cgEntrance: (document.getElementById('edit-fx-entrance') || {}).value,
                overlays: ovsEl ? Array.from(ovsEl.selectedOptions).map(o => o.value) : [],
                combo: (document.getElementById('edit-fx-combo') || {}).value,
                dramatic: (document.getElementById('edit-fx-dramatic') || {}).value
            });
        }
        this.refreshVisualDirector();
        this.refreshSceneList();
    },

    getSceneSpeakerName(scene) {
        if (!scene) return '';
        const roster = this.projectData && this.projectData.characterRoster ? this.projectData.characterRoster : [];
        const c = roster.find(x => x.id === scene.characterRef);
        if (c && c.name) return c.name;
        return '';
    },

    inferCgMediaType(urlOrPath) {
        const s = String(urlOrPath || '').toLowerCase();
        if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(s) || s.startsWith('data:video')) return 'video';
        return 'image';
    },

    getScene(id) {
        return this.projectData.scenes.find(s => s.id === id);
    },

    makeUniqueCastSpriteAlias(castId, exprKey) {
        const safeCast = String(castId).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48);
        const safeKey = String(exprKey).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
        let base = `spr_${safeCast}_${safeKey}`;
        let name = base;
        let n = 2;
        while (AssetManager.assetNameExists('characters', name)) {
            name = `${base}_${n++}`;
        }
        return name;
    },

    async loadProjectFromFile(file) {
        try {
            this.projectData = await StorageManager.loadProjectFile(file);
            this.migrateProjectData(this.projectData);
            AssetManager.init();
            AssetManager.applyProjectEmbedded(this.projectData.embeddedAssetLibrary || null);
            document.getElementById('current-project-name').innerText = this.projectData.projectName || '未命名项目';
            this.stepsPageVisible = false;
            const vs = document.getElementById('view-steps');
            if (vs) vs.style.display = 'none';
            const vstory = document.getElementById('view-story');
            if (vstory) vstory.style.display = 'flex';
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            const tabStory = document.getElementById('tab-story');
            if (tabStory) tabStory.classList.add('active');
            document.getElementById('view-cast').style.display = 'none';
            document.getElementById('view-assets').style.display = 'none';
            this.refreshSceneList();
            this.refreshCastList();
        } catch (err) {
            alert('加载失败: ' + err);
        }
    },

    createNewProject() {
        if (this.projectData) {
            const ok = confirm('将创建新的空白项目。当前未导出的修改可能丢失，是否继续？');
            if (!ok) return;
        }
        const name = prompt('请输入项目名', '未命名项目');
        if (name === null) return;
        const projectName = String(name || '').trim() || '未命名项目';
        const sceneId = 'start';
        this.projectData = {
            projectName,
            characterRoster: [],
            unifiedAttributes: [],
            relationAttributes: {},
            buildConfig: { publishMode: false },
            embeddedAssetLibrary: null,
            scenes: [
                {
                    id: sceneId,
                    name: '开场',
                    characterName: '',
                    characterRef: '',
                    expression: '',
                    character: { url: '', layout: { panX: 0, panY: 0, zoom: 1 } },
                    background: { url: '', fitPanX: 0, fitPanY: 0, fitZoom: 1 },
                    storyGraphic: {},
                    effects: { cgEntrance: '', overlays: [], combo: '', dramatic: '' },
                    text: '',
                    options: [],
                    appearedValue: 0,
                    steps: [
                        {
                            id: `step_${Date.now()}_dlg`,
                            type: 'dialogue',
                            speakerRef: '',
                            expression: '',
                            charMode: 'big',
                            mirror: false,
                            text: '',
                            appearedValue: 0,
                            effects: []
                        }
                    ]
                }
            ]
        };
        this.migrateProjectData(this.projectData);
        AssetManager.init();
        AssetManager.applyProjectEmbedded(this.projectData.embeddedAssetLibrary || null);
        document.getElementById('current-project-name').innerText = this.projectData.projectName || '未命名项目';
        this.stepsPageVisible = false;
        const tb = document.getElementById('toolbar');
        if (tb) tb.style.display = 'flex';
        const vs = document.getElementById('view-steps');
        if (vs) vs.style.display = 'none';
        const vstory = document.getElementById('view-story');
        if (vstory) vstory.style.display = 'flex';
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        const tabStory = document.getElementById('tab-story');
        if (tabStory) tabStory.classList.add('active');
        document.getElementById('view-cast').style.display = 'none';
        document.getElementById('view-assets').style.display = 'none';
        this.refreshSceneList();
        this.refreshCastList();
        this.selectScene(sceneId);
    },

    async bindProjectRootFolder(silent = false) {
        if (typeof window.showDirectoryPicker !== 'function') {
            if (!silent) alert('当前浏览器不支持选择文件夹。请使用 Chrome / Edge，并用 http://127.0.0.1 打开编辑器。');
            return false;
        }
        try {
            const dir = await window.showDirectoryPicker();
            if (typeof DirectoryMemory === 'undefined' || !DirectoryMemory.ensureProjectRootWritePermission) {
                if (!silent) alert('目录记忆模块未加载。');
                return false;
            }
            const ok = await DirectoryMemory.ensureProjectRootWritePermission(dir);
            if (!ok) {
                if (!silent) alert('需要对该文件夹的写入权限，才能把资源保存到项目内的 assets 目录。');
                return false;
            }
            await DirectoryMemory.saveProjectRootDirectory(dir);
            if (!silent) {
                alert(
                    '已绑定项目根目录。\n\n' +
                        '上传的图片/音频将优先写入「该文件夹下的 assets/…」，几乎不再占用浏览器存储。\n' +
                        '请选择你用 Simple Web Server 打开的那个游戏目录（与 index.html、episode.json 同级）。'
                );
            }
            return true;
        } catch (e) {
            if (e && e.name !== 'AbortError' && !silent) alert('绑定失败: ' + e);
            return false;
        }
    },

    assetTypeToSubdir(type) {
        const m = {
            characters: 'characters',
            backgrounds: 'backgrounds',
            music: 'music',
            sounds: 'sounds',
            particles: 'particles',
            storyGraphics: 'story_graphics'
        };
        return m[type] || 'misc';
    },

    sanitizeAssetFileBase(name) {
        let s = String(name || 'asset')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_');
        if (!s) s = 'asset';
        return s.slice(0, 180);
    },

    async copyFileIntoProjectAssets(projectRoot, type, file, baseName) {
        const sub = this.assetTypeToSubdir(type);
        const ext =
            file && file.name && file.name.lastIndexOf('.') > 0 ? file.name.slice(file.name.lastIndexOf('.')) : '';
        const safeBase = this.sanitizeAssetFileBase(baseName);
        const fileName = safeBase + ext;
        const assetsDir = await projectRoot.getDirectoryHandle('assets', { create: true });
        const typeDir = await assetsDir.getDirectoryHandle(sub, { create: true });
        const fh = await typeDir.getFileHandle(fileName, { create: true });
        const writable = await fh.createWritable();
        try {
            await writable.write(await file.arrayBuffer());
        } finally {
            await writable.close();
        }
        return `assets/${sub}/${fileName}`;
    },

    /**
     * 优先写入已绑定的项目目录（assets/…），失败再退回 localStorage + DataURL
     */
    async registerAssetPreferDisk(type, alias, file) {
        if (typeof DirectoryMemory !== 'undefined' && DirectoryMemory.getProjectRootDirectory) {
            const root = await DirectoryMemory.getProjectRootDirectory();
            if (root) {
                try {
                    const rel = await this.copyFileIntoProjectAssets(root, type, file, alias);
                    AssetManager.registerAsset(type, alias, rel, null);
                    return { disk: true };
                } catch (e) {
                    console.warn('registerAssetPreferDisk: disk write failed', e);
                    const reb = confirm(
                        '写入项目目录失败：\n' +
                            (e && e.message ? e.message : String(e)) +
                            '\n\n是否立即重新选择并绑定项目目录后重试？'
                    );
                    if (reb) {
                        const reboundOk = await this.bindProjectRootFolder(true);
                        if (reboundOk) {
                            const root2 = await DirectoryMemory.getProjectRootDirectory();
                            if (root2) {
                                const rel = await this.copyFileIntoProjectAssets(root2, type, file, alias);
                                AssetManager.registerAsset(type, alias, rel, null);
                                return { disk: true };
                            }
                        }
                    }
                    alert('将改试浏览器内存储（可能仍会因空间不足而失败）。');
                }
            } else {
                console.warn('registerAssetPreferDisk: no writable project root for current origin', location.origin);
            }
        }
        const dataUrl = await StorageManager.readFileAsDataURL(file);
        const res = await this.registerAssetWithQuotaFallback(type, alias, file, dataUrl);
        return { disk: false, ...res };
    },

    async pickProjectFileWithMemory() {
        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const key = 'picker:project-load';
                const startIn =
                    typeof DirectoryMemory !== 'undefined' && DirectoryMemory.getStartInHandleWithFallback
                        ? await DirectoryMemory.getStartInHandleWithFallback([key])
                        : undefined;
                const opts = {
                    id: 'storyengine-project-load',
                    types: [{ description: '项目文件', accept: { 'application/json': ['.json'] } }],
                    multiple: false
                };
                if (startIn) opts.startIn = startIn;
                const [handle] = await window.showOpenFilePicker(opts);
                if (typeof DirectoryMemory !== 'undefined' && DirectoryMemory.saveStartInHandle) {
                    await DirectoryMemory.saveStartInHandle(key, handle);
                }
                return await handle.getFile();
            } catch (e) {
                if (e && e.name === 'AbortError') return null;
                console.warn('pickProjectFileWithMemory', e);
            }
        }
        document.getElementById('load-project').click();
        return null;
    },

    /**
     * 再次打开上次通过「打开」选中的 JSON（依赖 FileSystemFileHandle 缓存；纯 file input 选文件不会留下句柄）。
     */
    async openLastProjectFromMemory() {
        const key = 'picker:project-load';
        if (typeof DirectoryMemory === 'undefined' || !DirectoryMemory.getStartInHandle) {
            alert('当前环境无法记忆上次项目。请使用 Chrome/Edge，并通过左侧「打开」选择 .json（不要用仅支持传统文件框的环境）。');
            return;
        }
        const handle = await DirectoryMemory.getStartInHandle(key);
        if (!handle || typeof handle.getFile !== 'function') {
            alert('还没有记录到上次打开的项目。请先点击「打开」，在系统文件框里选择一次项目 JSON。');
            return;
        }
        const ok = await DirectoryMemory.ensureReadPermission(handle);
        if (!ok) {
            alert('无法读取上次项目文件（权限未授予）。请使用「打开」重新选择文件。');
            return;
        }
        let file;
        try {
            file = await handle.getFile();
        } catch (e) {
            alert('读取上次项目失败：' + (e && e.message ? e.message : String(e)));
            return;
        }
        await this.loadProjectFromFile(file);
    },

    async registerAssetWithQuotaFallback(type, alias, file, originalDataUrl) {
        try {
            AssetManager.registerAsset(type, alias, file.name, originalDataUrl);
            return { status: 'ok', compressed: false };
        } catch (err) {
            if (!err || err.message !== 'QUOTA') throw err;
        }
        const isImage = file && typeof file.type === 'string' && file.type.startsWith('image/');
        if (isImage && StorageManager.buildImageCompressionCandidates) {
            const candidates = await StorageManager.buildImageCompressionCandidates(file);
            for (const dataUrl of candidates) {
                try {
                    AssetManager.registerAsset(type, alias, file.name, dataUrl);
                    return { status: 'ok', compressed: true };
                } catch (retryErr) {
                    if (!retryErr || retryErr.message !== 'QUOTA') throw retryErr;
                }
            }
        }
        throw new Error('QUOTA');
    },

    async pickAndRegisterAsset(type, pickerKey, opts = {}) {
        const file = await Editor.pickAssetFileWithMemory(type, pickerKey, opts);
        if (!file) return null;
        let alias = (file.name || '').replace(/\.[^/.]+$/, '').trim();
        if (!alias) alias = `${type}_${Date.now()}`;
        if (AssetManager.assetNameExists(type, alias)) {
            alert(`资源名“${alias}”已存在，请重命名后重试。`);
            return null;
        }
        try {
            const r = await this.registerAssetPreferDisk(type, alias, file);
            if (!r.disk && r.compressed) alert('存储空间紧张，已自动压缩图片后保存。');
        } catch (err) {
            if (err && err.message === 'QUOTA') {
                alert(
                    '浏览器存储空间不足。\n\n请先点击工具栏「📁 绑定项目目录」，选择你用 Simple Web Server 打开的游戏文件夹；上传会写入其中的 assets 目录，不再占用浏览器配额。\n\n若你已绑定仍失败，请确认当前地址与绑定时一致（127.0.0.1 和 localhost 视为不同站点），再重新绑定一次。'
                );
                return null;
            }
            alert('注册资源失败: ' + err);
            return null;
        }
        return { alias, file };
    },

    async _bindExpressionSpriteFile(castMember, exprKey, file) {
        if (!castMember || !exprKey || !file) return false;
        const alias = Editor.makeUniqueCastSpriteAlias(castMember.id, exprKey);
        try {
            const r = await this.registerAssetPreferDisk('characters', alias, file);
            if (!r.disk && r.compressed) {
                alert('存储空间紧张，已自动压缩立绘后保存。');
            }
        } catch (err) {
            if (err && err.message === 'QUOTA') {
                alert(
                    '浏览器存储空间不足。请点击工具栏「📁 绑定项目目录」后重试上传，资源将写入项目 assets 目录。'
                );
                return false;
            }
            alert('注册失败: ' + err);
            return false;
        }
        castMember.expressions = castMember.expressions || {};
        castMember.expressions[exprKey] = castMember.expressions[exprKey] || {};
        castMember.expressions[exprKey].spriteAsset = alias;
        return true;
    },

    async uploadAndBindExpressionSprite(castMember, exprKey) {
        const safeExpr = String(exprKey || 'expr').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
        const file = await Editor.pickAssetFileWithMemory('characters', `cast-expr-${castMember.id}-${safeExpr}`);
        if (!file) return;
        await this._bindExpressionSpriteFile(castMember, exprKey, file);
    },

    async uploadExpressionFromStep(step) {
        if (!step || !step.speakerRef) {
            alert('请先选择说话人。');
            return;
        }
        const cast = (this.projectData.characterRoster || []).find(c => c.id === step.speakerRef);
        if (!cast) {
            alert('找不到该说话人角色。');
            return;
        }
        const file = await this.pickAssetFileWithMemory(
            'characters',
            `step-expr-${cast.id}-${step.id || 'new'}`
        );
        if (!file) return;
        const exprName = prompt(
            '已选择立绘图片。请输入情绪名（将保存到该说话人预设中，同角色内不可与已有情绪重名）',
            step.expression || ''
        );
        if (exprName === null) return;
        const key = (exprName || '').trim();
        if (!key) {
            alert('情绪名不能为空。');
            return;
        }
        cast.expressions = cast.expressions || {};
        if (cast.expressions[key]) {
            alert('该角色下已有同名情绪，请换一个名字。');
            return;
        }
        const ok = await this._bindExpressionSpriteFile(cast, key, file);
        if (ok) step.expression = key;
    },

    async pickAssetFileWithMemory(type, pickerKey = '', opts = {}) {
        const isAudio = type === 'sounds' || type === 'music';
        const isStoryGraphic = type === 'storyGraphics';
        const allowVideo = !!opts.allowVideo;
        const acceptTypes = isAudio
            ? [{ description: '音频', accept: { 'audio/*': ['.mp3', '.ogg', '.wav', '.m4a', '.aac'] } }]
            : isStoryGraphic && allowVideo
                ? [{ description: '图片或视频', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'], 'video/*': ['.mp4', '.webm'] } }]
                : [{ description: '图片', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] } }];

        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const memoryKey = pickerKey ? `picker:${pickerKey}` : '';
                const typeKey = `picker:type:${type}`;
                const fallbackKeys = memoryKey ? [memoryKey] : [typeKey, type];
                const startIn =
                    typeof DirectoryMemory !== 'undefined' && DirectoryMemory.getStartInHandleWithFallback
                        ? await DirectoryMemory.getStartInHandleWithFallback(fallbackKeys)
                        : undefined;
                const opts = {
                    id: pickerKey ? `storyengine-asset-${pickerKey}` : `storyengine-asset-${type}`,
                    types: acceptTypes,
                    multiple: false
                };
                if (startIn) opts.startIn = startIn;
                const [handle] = await window.showOpenFilePicker(opts);
                if (typeof DirectoryMemory !== 'undefined' && DirectoryMemory.saveStartInHandle) {
                    await DirectoryMemory.saveStartInHandle(typeKey, handle);
                    if (memoryKey) await DirectoryMemory.saveStartInHandle(memoryKey, handle);
                }
                return await handle.getFile();
            } catch (e) {
                if (e && e.name === 'AbortError') return null;
                console.warn('showOpenFilePicker', e);
            }
        }

        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = isAudio ? 'audio/*' : (isStoryGraphic && allowVideo ? 'image/*,video/*' : 'image/*');
            input.style.display = 'none';
            document.body.appendChild(input);
            input.onchange = () => {
                const f = input.files && input.files[0];
                document.body.removeChild(input);
                resolve(f || null);
            };
            setTimeout(() => {
                input.click();
            }, 0);
        });
    }
};

window.onload = () => Editor.init();
