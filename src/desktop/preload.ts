import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("wechat", {
  evaluationReport: () => ipcRenderer.invoke("evaluationReport"),
  labelBehavior: (
    id: string,
    index: number,
    behavior: string,
    expected: string,
  ) => ipcRenderer.invoke("labelBehavior", id, index, behavior, expected),
  settings: () => ipcRenderer.invoke("settings"),
  saveSettings: (value: unknown) => ipcRenderer.invoke("saveSettings", value),
  backgroundStatus: () => ipcRenderer.invoke("backgroundStatus"),
  pauseBackground: () => ipcRenderer.invoke("pauseBackground"),
  resumeBackground: () => ipcRenderer.invoke("resumeBackground"),
  refreshView: (id: string) => ipcRenderer.invoke("refreshView", id),
  jevModel: () => ipcRenderer.invoke("jevModel"),
  setJevModel: (model: string) => ipcRenderer.invoke("setJevModel", model),
  startTranscription: (
    id: string,
    messageId?: string,
    mode?: "fast" | "accurate",
    concurrency?: number,
  ) =>
    ipcRenderer.invoke("startTranscription", id, messageId, mode, concurrency),
  editTranscript: (id: string, messageId: string, text: string) =>
    ipcRenderer.invoke("editTranscript", id, messageId, text),
  status: () => ipcRenderer.invoke("status"),
  connection: () => ipcRenderer.invoke("connection"),
  openWechatSetup: () => ipcRenderer.invoke("openWechatSetup"),
  openTranscriptFolder: () => ipcRenderer.invoke("openTranscriptFolder"),
  openJevWebsite: (destination: "home" | "console") =>
    ipcRenderer.invoke("openJevWebsite", destination),
  startRead: (id: string, range: unknown, resume?: boolean) =>
    ipcRenderer.invoke("startRead", id, range, resume),
  job: (id: string) => ipcRenderer.invoke("job", id),
  cancelJob: (id: string) => ipcRenderer.invoke("cancelJob", id),
  startMediaRecognition: (id: string, retry?: boolean) =>
    ipcRenderer.invoke("startMediaRecognition", id, retry),
  previewPlan: (id: string) => ipcRenderer.invoke("previewPlan", id),
  previewBatch: (token: string, index: number) =>
    ipcRenderer.invoke("previewBatch", token, index),
  startAnalysis: (id: string, token: string) =>
    ipcRenderer.invoke("startAnalysis", id, token),
  conversations: () => ipcRenderer.invoke("conversations"),
  open: (id: string) => ipcRenderer.invoke("open", id),
  preview: (id: string) => ipcRenderer.invoke("preview", id),
  analyze: (id: string, state: string) =>
    ipcRenderer.invoke("analyze", id, state),
  hasKey: () => ipcRenderer.invoke("hasKey"),
  saveKey: (key: string) => ipcRenderer.invoke("saveKey", key),
  deleteKey: () => ipcRenderer.invoke("deleteKey"),
});
