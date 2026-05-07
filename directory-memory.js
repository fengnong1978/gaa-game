/**
 * directory-memory.js - 按资源类型持久化「上次使用的文件夹」(FileSystemDirectoryHandle)
 * 需 https / localhost；file:// 下会静默失败并回退为仅 showOpenFilePicker 的 id。
 */
const DirectoryMemory = {
    DB_NAME: 'storyengine_directory_memory',
    STORE: 'handles',
    DB_VERSION: 1,

    /** 项目根目录（含 assets 写入权限），用于把资源落到磁盘、避免 localStorage 爆满 */
    PROJECT_ROOT_KEY: 'storyengine-project-root',

    _dbPromise: null,

    _openDb() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(this.STORE)) {
                    db.createObjectStore(this.STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
        });
        return this._dbPromise;
    },

    async saveDirectoryForAssetType(type, directoryHandle) {
        try {
            const db = await this._openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(this.STORE).put(directoryHandle, type);
            });
        } catch (e) {
            console.warn('DirectoryMemory.saveDirectoryForAssetType', e);
        }
    },

    async saveStartInHandle(key, handle) {
        if (!key || !handle) return;
        try {
            const db = await this._openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(this.STORE).put(handle, key);
            });
        } catch (e) {
            console.warn('DirectoryMemory.saveStartInHandle', e);
        }
    },

    async getStartInHandle(key) {
        if (!key) return null;
        try {
            const db = await this._openDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readonly');
                tx.onerror = () => reject(tx.error);
                const req = tx.objectStore(this.STORE).get(key);
                req.onsuccess = () => resolve(req.result || null);
            });
        } catch (e) {
            return null;
        }
    },

    async getDirectoryForAssetType(type) {
        try {
            const db = await this._openDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readonly');
                tx.onerror = () => reject(tx.error);
                const req = tx.objectStore(this.STORE).get(type);
                req.onsuccess = () => resolve(req.result || null);
            });
        } catch (e) {
            return null;
        }
    },

    async ensureReadPermission(dirHandle) {
        if (!dirHandle || !dirHandle.queryPermission) return false;
        const opts = { mode: 'read' };
        let state = await dirHandle.queryPermission(opts);
        if (state === 'granted') return true;
        state = await dirHandle.requestPermission(opts);
        return state === 'granted';
    },

    /** 供 showOpenFilePicker 的 startIn 使用 */
    async getStartInDirectoryHandle(type) {
        const h = await this.getDirectoryForAssetType(type);
        if (!h) return undefined;
        const ok = await this.ensureReadPermission(h);
        return ok ? h : undefined;
    },

    async getStartInHandleWithFallback(keys = []) {
        for (const key of keys) {
            const h = await this.getStartInHandle(key);
            if (!h) continue;
            const ok = await this.ensureReadPermission(h);
            if (ok) return h;
        }
        return undefined;
    },

    async saveProjectRootDirectory(directoryHandle) {
        if (!directoryHandle) return;
        try {
            const db = await this._openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(this.STORE).put(directoryHandle, this.PROJECT_ROOT_KEY);
            });
        } catch (e) {
            console.warn('DirectoryMemory.saveProjectRootDirectory', e);
        }
    },

    async getProjectRootDirectoryHandle() {
        try {
            const db = await this._openDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readonly');
                tx.onerror = () => reject(tx.error);
                const req = tx.objectStore(this.STORE).get(this.PROJECT_ROOT_KEY);
                req.onsuccess = () => resolve(req.result || null);
            });
        } catch (e) {
            return null;
        }
    },

    async ensureProjectRootWritePermission(dirHandle) {
        if (!dirHandle || !dirHandle.queryPermission) return false;
        const opts = { mode: 'readwrite' };
        try {
            let state = await dirHandle.queryPermission(opts);
            if (state === 'granted') return true;
            state = await dirHandle.requestPermission(opts);
            return state === 'granted';
        } catch {
            return false;
        }
    },

    /** 已绑定且当前仍具备读写权限时返回句柄，否则 null */
    async getProjectRootDirectory() {
        const h = await this.getProjectRootDirectoryHandle();
        if (!h) return null;
        const ok = await this.ensureProjectRootWritePermission(h);
        return ok ? h : null;
    }
};
