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
  },
  library: {
    search: query => ipcRenderer.invoke('library:search', query),
  },
  image: {
    save: payload => ipcRenderer.invoke('image:save', payload),
  },
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get'),
    setTheme: theme => ipcRenderer.invoke('settings:setTheme', theme),
  },
  commands: {
    onEditorCommand: callback => {
      const listener = (_event, command) => callback(command)
      ipcRenderer.on('editor:command', listener)
      return () => ipcRenderer.removeListener('editor:command', listener)
    },
  },
})
