const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vibenote', {
  buffer: {
    list: () => ipcRenderer.invoke('buffer:list'),
    load: path => ipcRenderer.invoke('buffer:load', path),
    save: (path, content) => ipcRenderer.invoke('buffer:save', path, content),
    saveSync: (path, content) => {
      const result = ipcRenderer.sendSync('buffer:saveSync', path, content)
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to save buffer synchronously')
      }
      return true
    },
    snapshot: (path, content, reason) => ipcRenderer.invoke('buffer:snapshot', path, content, reason),
    snapshotSync: (path, content, reason) => {
      const result = ipcRenderer.sendSync('buffer:snapshotSync', path, content, reason)
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to create snapshot synchronously')
      }
      return true
    },
    create: name => ipcRenderer.invoke('buffer:create', name),
    delete: path => ipcRenderer.invoke('buffer:delete', path),
    archiveStream: name => ipcRenderer.invoke('buffer:archiveStream', name),
    openExternal: () => ipcRenderer.invoke('buffer:openExternal'),
    createExternal: () => ipcRenderer.invoke('buffer:createExternal'),
    listRecoveries: () => ipcRenderer.invoke('buffer:listRecoveries'),
    readRecovery: path => ipcRenderer.invoke('buffer:readRecovery', path),
    consumePendingOpen: () => ipcRenderer.invoke('buffer:consumePendingOpen'),
    onOpened: callback => {
      const listener = (_event, buffer) => callback(buffer)
      ipcRenderer.on('buffer:opened', listener)
      return () => ipcRenderer.removeListener('buffer:opened', listener)
    },
  },
  library: {
    search: query => ipcRenderer.invoke('library:search', query),
  },
  image: {
    save: payload => ipcRenderer.invoke('image:save', payload),
    resolveLegacyUrl: url => ipcRenderer.invoke('image:resolveLegacyUrl', url),
  },
  shell: {
    openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  },
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get'),
    setTheme: theme => ipcRenderer.invoke('settings:setTheme', theme),
  },
  gitBackup: {
    getSettings: () => ipcRenderer.invoke('git-backup:getSettings'),
    getStatus: () => ipcRenderer.invoke('git-backup:getStatus'),
    chooseRepository: () => ipcRenderer.invoke('git-backup:chooseRepository'),
    setEnabled: enabled => ipcRenderer.invoke('git-backup:setEnabled', enabled),
    onStatusChanged: callback => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('git-backup:status-changed', listener)
      return () => ipcRenderer.removeListener('git-backup:status-changed', listener)
    },
  },
  lifecycle: {
    onFlushBeforeQuit: callback => {
      const listener = (_event, requestId) => callback(requestId)
      ipcRenderer.on('app:flush-before-quit', listener)
      return () => ipcRenderer.removeListener('app:flush-before-quit', listener)
    },
    confirmFlushBeforeQuit: requestId => ipcRenderer.send('app:flush-before-quit-complete', requestId),
  },
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    saveSettings: settings => ipcRenderer.invoke('ai:saveSettings', settings),
    setApiKey: apiKey => ipcRenderer.invoke('ai:setApiKey', apiKey),
    clearApiKey: () => ipcRenderer.invoke('ai:clearApiKey'),
    testConnection: () => ipcRenderer.invoke('ai:testConnection'),
    complete: payload => ipcRenderer.invoke('ai:complete', payload),
  },
  commands: {
    onEditorCommand: callback => {
      const listener = (_event, command) => callback(command)
      ipcRenderer.on('editor:command', listener)
      return () => ipcRenderer.removeListener('editor:command', listener)
    },
  },
})
