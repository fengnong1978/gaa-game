/**
 * scene-manager.js - 场景调度中心 (容错加强版)
 */
const SceneManager = {
    currentSceneId: "start", 
    storyData: null,
    currentStepIndex: 0,
    /** @type {{ mode: 'none'|'choice'|'cg', stepId?: string }} */
    uiMode: { mode: 'none' },
    /** @type {{ sourceStep: object, visualActive: boolean, musicActive: boolean } | null} */
    _cgSession: null,
    /** 刚执行过 Renderer.renderScene，本步 enterCurrentStep 不清理上一步特效（避免冲掉场景级入场） */
    _effectsFreshFromSceneRender: false,

    init(data) {
        this.storyData = this.upgradeProjectData(data || {});
        this.currentStepIndex = 0;
        this.uiMode = { mode: 'none' };
        this._cgSession = null;
        // 发布模式：导出时写入 buildConfig.publishMode
        if (typeof GameState !== 'undefined' && GameState.runtimeConfig) {
            const pub = !!(this.storyData && this.storyData.buildConfig && this.storyData.buildConfig.publishMode);
            GameState.runtimeConfig.publishMode = pub;
            if (pub) GameState.runtimeConfig.fixedSeed = false;
        }
        console.log("场景管理器初始化成功");
    },

    getScene(id) {
        if (!this.storyData || !this.storyData.scenes) return null;
        
        // 尝试通过 ID 寻找场景
        const scene = this.storyData.scenes.find(s => s.id === id);
        
        // 【保底机制】如果找不到指定 ID，或者 ID 错误，则默认返回第一个场景
        if (!scene) {
            console.warn(`找不到场景ID: ${id}，自动跳转至首个场景`);
            return this.storyData.scenes[0];
        }
        return scene;
    },

    /** 升级旧项目数据为 steps 脚本结构（兼容老字段） */
    upgradeProjectData(project) {
        if (!project || typeof project !== 'object') return project;
        if (!Array.isArray(project.scenes)) project.scenes = [];
        project.scenes.forEach(scene => {
            if (!scene || typeof scene !== 'object') return;
            if (!scene.id) scene.id = 'scene_' + Date.now();
            if (!scene.name) scene.name = scene.id;
            if (!Array.isArray(scene.steps)) {
                // 旧版：scene.text + scene.options + scene.storyGraphic（仅作为兼容迁移）
                const steps = [];
                const oldText = typeof scene.text === 'string' ? scene.text : '';
                const hasText = oldText.trim().length > 0;
                if (hasText) {
                    steps.push({
                        id: 'step_' + Date.now() + '_dlg',
                        type: 'dialogue',
                        speakerRef: scene.characterRef || '',
                        expression: scene.expression || '',
                        text: oldText
                    });
                }
                if (scene.storyGraphic && (scene.storyGraphic.embeddedDataUrl || scene.storyGraphic.url)) {
                    steps.unshift({
                        id: 'step_' + Date.now() + '_cg',
                        type: 'cg',
                        cg: { ...(scene.storyGraphic || {}) },
                        hideDialogue: false,
                        hideCharacter: false
                    });
                }
                if (Array.isArray(scene.options) && scene.options.length) {
                    steps.push({
                        id: 'step_' + Date.now() + '_choice',
                        type: 'choice',
                        options: scene.options.map(o => ({
                            text: o.text || '',
                            // 旧版 options 只能跳场景
                            next: { type: 'scene', sceneId: o.target || 'start' },
                            effects: o.action ? [{ kind: 'var', var: o.action.var, op: 'add', val: o.action.val }] : []
                        }))
                    });
                }
                scene.steps = steps;
            }
            // 统一补齐 steps 字段
            scene.steps = (scene.steps || []).filter(Boolean).map((s, idx) => ({
                id: s.id || `${scene.id}_step_${idx}_${Date.now()}`,
                type: s.type || 'dialogue',
                ...s
            }));
        });
        return project;
    },

    jumpToScene(sceneId, startLabelSuffix = '') {
        if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) StoryEffects.stopCgMusicOnly();
        this._cgSession = null;
        if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();

        this.currentSceneId = sceneId;
        const scene = this.getScene(sceneId);
        if (!scene) return;
        this.currentStepIndex = 0;
        if (startLabelSuffix) {
            const idx = (scene.steps || []).findIndex(s => s && s.labelSuffix === startLabelSuffix);
            if (idx >= 0) this.currentStepIndex = idx;
        }
        if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
            StoryEffects.playMusicForScene(scene);
        }
        if (typeof Renderer !== 'undefined') Renderer.renderScene(scene);
        this._effectsFreshFromSceneRender = true;
        this.enterCurrentStep();
    },

    /** 兼容旧 API：jumpTo(id) */
    jumpTo(id) {
        this.jumpToScene(id, '');
    },

    getCurrentStep() {
        const scene = this.getScene(this.currentSceneId);
        if (!scene || !Array.isArray(scene.steps)) return null;
        return scene.steps[this.currentStepIndex] || null;
    },

    clearCgSessionHard(scene) {
        this._cgSession = null;
        if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();
        if (typeof StoryEffects !== 'undefined') {
            if (StoryEffects.stopCgMusicResumeBgm && scene) StoryEffects.stopCgMusicResumeBgm(scene, 0);
            else if (StoryEffects.stopCgMusicOnly) StoryEffects.stopCgMusicOnly();
        }
    },

    /** 进入某步时：按 CG 步骤上配置的「在第几步停止」处理画面与音乐 */
    applyCgSessionForEnterStep(scene, step) {
        const sess = this._cgSession;
        if (!sess || !sess.sourceStep) return;
        const src = sess.sourceStep;
        // 编辑/加载后 sourceStep 上已取消 CG 音乐，但会话里仍为 musicActive 时，立刻停 CG 轨并恢复场景 BGM
        if (sess.musicActive && !src.cgMusicAlias) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
                StoryEffects.stopCgMusicResumeBgm(scene, 0);
            }
            sess.musicActive = false;
        }
        if (sess.musicActive && src.cgMusicStopAtStepId && step.id === src.cgMusicStopAtStepId) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
                StoryEffects.stopCgMusicResumeBgm(scene);
            }
            sess.musicActive = false;
        }
        if (sess.visualActive && src.cgStopAtStepId && step.id === src.cgStopAtStepId) {
            if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();
            sess.visualActive = false;
        }
        if (!sess.visualActive && !sess.musicActive) {
            this._cgSession = null;
        }
    },

    /** 进入新的 CG 步骤：顶替上一段 CG（画面+音乐） */
    enterCgStepSession(scene, step) {
        const prev = this._cgSession && this._cgSession.sourceStep;
        if (prev && prev.id !== step.id) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) StoryEffects.stopCgMusicOnly();
            if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();
        }
        // 同一 CG 步骤再次进入、或编辑去掉 cgMusicAlias 后：上一分支会因 id 相同而不 stop，须显式停掉 CG 音轨
        if (!step.cgMusicAlias && typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) {
            StoryEffects.stopCgMusicOnly();
        }
        this._cgSession = {
            sourceStep: step,
            visualActive: true,
            musicActive: !!step.cgMusicAlias
        };
        if (step.cgMusicAlias) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.playCgMusic) {
                StoryEffects.playCgMusic(step.cgMusicAlias, step.cgMusicLoop !== false);
            }
        } else if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
            StoryEffects.playMusicForScene(scene);
        }
    },

    enterCurrentStep() {
        const scene = this.getScene(this.currentSceneId);
        const step = this.getCurrentStep();
        if (!scene || !step) return;

        const t = step.type || 'dialogue';
        if (t === 'choice' || t === 'random') {
            this.clearCgSessionHard(scene);
        } else if (t === 'cg') {
            this.enterCgStepSession(scene, step);
        } else {
            this.applyCgSessionForEnterStep(scene, step);
        }

        const hideCharForCgOverlay =
            this._cgSession &&
            this._cgSession.visualActive &&
            this._cgSession.sourceStep &&
            this._cgSession.sourceStep.hideCharacter !== false;

        if (hideCharForCgOverlay) {
            const charLayer = document.getElementById('layer-char');
            if (charLayer) charLayer.innerHTML = '';
        }

        const runApplyStepFx = () => {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.applyStepFx) {
                StoryEffects.applyStepFx(step);
            }
        };

        if (typeof StoryEffects !== 'undefined') {
            const skipCleanup = this._effectsFreshFromSceneRender;
            this._effectsFreshFromSceneRender = false;
            if (!skipCleanup && StoryEffects.cleanupStepVisualFx) {
                StoryEffects.cleanupStepVisualFx();
            }
        }

        // 冲击特效 + 自定义音效（冲突规则：只播自定义音效）
        if (step.dramaticEffect && typeof StoryEffects !== 'undefined' && StoryEffects._runDramatic) {
            const hasCustomSound = !!step.soundAlias;
            StoryEffects._runDramatic(step.dramaticEffect, { muteSound: hasCustomSound });
        }
        if (step.soundAlias && typeof StoryEffects !== 'undefined' && StoryEffects.playSound) {
            StoryEffects.playSound(step.soundAlias);
        }

        if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
        this.uiMode = { mode: 'none' };

        // 统一：步骤进入时应用 effects（台词/CG/随机/选项分支）——此处先处理 step.effects
        if (typeof GameState !== 'undefined' && GameState.applyEffects && Array.isArray(step.effects)) {
            GameState.applyEffects(step.effects);
        }

        if (step.type === 'choice') {
            this.uiMode = { mode: 'choice', stepId: step.id };
            if (typeof UIManager !== 'undefined' && UIManager.showChoiceStep) {
                UIManager.showChoiceStep(step);
            }
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            return;
        }

        if (step.type === 'random') {
            const picked = this.pickWeightedRandom(step);
            if (!picked) return;
            if (picked.effects && typeof GameState !== 'undefined' && GameState.applyEffects) {
                GameState.applyEffects(picked.effects);
            }
            if (picked.next) this.applyNext(picked.next);
            else this.advanceStep();
            return;
        }

        if (step.type === 'cg') {
            this.uiMode = { mode: 'cg', stepId: step.id };
            if (typeof UIManager !== 'undefined' && UIManager.showCgStep) {
                UIManager.showCgStep(step);
            }
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            return;
        }

        if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
            const overlayCg =
                this._cgSession && this._cgSession.visualActive && this._cgSession.sourceStep
                    ? this._cgSession.sourceStep
                    : null;
            UIManager.showTextStep(scene, step, overlayCg);
        }
        runApplyStepFx();
        this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
    },

    /** 在对话框等布局更新后再测距绘制立绘（小图模式依赖对话框上沿位置） */
    _scheduleCharacterRedraw(scene, step, charHiddenByCg) {
        if (charHiddenByCg) return;
        const run = () => {
            if (typeof Renderer !== 'undefined' && Renderer.renderCharacterForStep) {
                Renderer.renderCharacterForStep(scene, step);
            }
        };
        if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run);
        else run();
    },

    /** 条件过滤 + 加权随机；候选为空则结束游戏 */
    pickWeightedRandom(step) {
        const rows = (step && step.table) || (step && step.rows) || [];
        const candidates = [];
        let total = 0;
        rows.forEach(r => {
            if (!r) return;
            if (!this.evalCondition(r.condition)) return;
            const w = Number(r.weight);
            if (!Number.isFinite(w) || w <= 0) return;
            total += w;
            candidates.push({ ...r, _w: w });
        });
        if (!candidates.length || total <= 0) {
            if (typeof UIManager !== 'undefined' && UIManager.showGameOver) {
                UIManager.showGameOver('因为没有随机可选项，游戏结束。');
            } else {
                alert('因为没有随机可选项，游戏结束。');
            }
            this.uiMode = { mode: 'none' };
            return null;
        }
        const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
        let x = r * total;
        for (const c of candidates) {
            x -= c._w;
            if (x <= 0) return c;
        }
        return candidates[candidates.length - 1];
    },

    evalCondition(cond) {
        if (!cond) return true;
        if (typeof cond === 'boolean') return cond;
        if (Array.isArray(cond.and)) return cond.and.every(c => this.evalCondition(c));
        if (Array.isArray(cond.or)) return cond.or.some(c => this.evalCondition(c));
        if (cond.type === 'var') {
            const cur = typeof GameState !== 'undefined' && GameState.get ? GameState.get(cond.key) : undefined;
            return this._cmp(cur, cond.op, cond.value);
        }
        if (cond.type === 'unified') {
            const cur = typeof GameState !== 'undefined' && GameState.getUnified ? GameState.getUnified(cond.charId, cond.key) : undefined;
            return this._cmp(cur, cond.op, cond.value);
        }
        if (cond.type === 'relation') {
            const cur = typeof GameState !== 'undefined' && GameState.getRelationAffection ? GameState.getRelationAffection(cond.from, cond.to) : undefined;
            return this._cmp(cur, cond.op, cond.value);
        }
        return true;
    },

    _cmp(cur, op, value) {
        const a = typeof cur === 'boolean' ? cur : Number(cur);
        const b = typeof value === 'boolean' ? value : Number(value);
        if (op === '==') return a == b;
        if (op === '!=') return a != b;
        if (op === '>=') return a >= b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        if (op === '<') return a < b;
        return !!a;
    },

    /** 点击推进（对话翻页 / CG关闭 / 进入下一步） */
    onAdvance() {
        const step = this.getCurrentStep();
        if (!step) return;

        if (this.uiMode.mode === 'choice') {
            // 等玩家点选项按钮
            return;
        }

        if (this.uiMode.mode === 'cg') {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            this.uiMode = { mode: 'none' };
            this.advanceStep();
            return;
        }

        if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
            if (!UIManager.isAtEndOfStep()) {
                // 若下一步是选项：点击一次直接展开全部对白并立即弹出选项
                const scene = this.getScene(this.currentSceneId);
                const next = scene && scene.steps ? scene.steps[this.currentStepIndex + 1] : null;
                if (next && next.type === 'choice' && UIManager.jumpToEndOfStep) {
                    UIManager.jumpToEndOfStep();
                    this.advanceStep();
                    return;
                }
                UIManager.nextPage();
                return;
            }
            // 已到本步末尾：进入下一步
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            this.advanceStep();
        }
    },

    advanceStep() {
        const scene = this.getScene(this.currentSceneId);
        if (!scene || !Array.isArray(scene.steps)) return;
        this.currentStepIndex = Math.min(scene.steps.length, this.currentStepIndex + 1);
        if (this.currentStepIndex >= scene.steps.length) {
            // 场景跑完：回到 start 或停住
            this.jumpToScene('start', '');
            return;
        }
        this.enterCurrentStep();
    },

    applyNext(next) {
        if (!next || typeof next !== 'object') return;
        if (next.type === 'scene') {
            this.jumpToScene(next.sceneId || 'start', next.labelSuffix || '');
            return;
        }
        if (next.type === 'label') {
            const scene = this.getScene(this.currentSceneId);
            if (!scene) return;
            const idx = (scene.steps || []).findIndex(s => s && s.labelSuffix === next.labelSuffix);
            if (idx >= 0) {
                this.currentStepIndex = idx;
                this.enterCurrentStep();
            }
            return;
        }
        if (next.type === 'ending') {
            // 结局先用跳场景实现
            this.jumpToScene(next.sceneId || 'start', next.labelSuffix || '');
        }
    }
};
