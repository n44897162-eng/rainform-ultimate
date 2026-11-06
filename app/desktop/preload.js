/* Context-isolated bridge. weather.js automatically prefers
 * window.RainNative.fetch when present, which bypasses browser CORS for
 * self-hosted REST / crawler / custom endpoints. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('RainNative', {
  /**
   * @param {string} url
   * @param {{method?:string,headers?:object,body?:string,timeout?:number}} opts
   * @returns {Promise<{ok:boolean,status:number,body:string}>}
   */
  fetch: (url, opts) => ipcRenderer.invoke('rain:fetch', url, opts || {}),
  openExternal: url => ipcRenderer.invoke('rain:external', url),
  info: () => ipcRenderer.invoke('rain:info'),
  platform: process.platform,
  isDesktop: true
});
