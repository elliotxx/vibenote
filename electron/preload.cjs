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
    create: name => ipcRenderer.invoke('buffer:create', name),
    delete: path => ipcRenderer.invoke('buffer:delete', path),
    archiveStream: name => ipcRenderer.invoke('buffer:archiveStream', name),
    openExternal: () => ipcRenderer.invoke('buffer:openExternal'),
    createExternal: () => ipcRenderer.invoke('buffer:createExternal'),
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
