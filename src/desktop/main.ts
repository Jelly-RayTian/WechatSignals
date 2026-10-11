import { LocalImageRecognizer } from "../infrastructure/image-ocr";
import { settingsSchema } from "../domain/settings";
import { BackgroundSpeech } from "../application/background-speech";
import { z } from "zod";
import {
  GreenBubblesPlugin,
  createPreflightProbe,
} from "../plugins/greenbubbles-plugin";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { behaviorDefinitions } from "../infrastructure/jev-behaviors";
import { ApplicationService } from "../application/service";
import {
  GreenBubblesAdapter,
  createGreenBubblesRunner,
} from "../infrastructure/greenbubbles";
import { JevAnalysisService } from "../infrastructure/jev";
import { KeychainStore } from "../infrastructure/keychain";
import { SqliteRepository } from "../infrastructure/sqlite";
import { voiceMaterializer } from "../infrastructure/greenbubbles-voice";
import { LocalSpeechTranscriber } from "../infrastructure/speech";
if (process.env.WECHAT_SIGNALS_TEST_DATA_DIR)
  app.setPath("userData", process.env.WECHAT_SIGNALS_TEST_DATA_DIR);
app
  .whenReady()
  .then(async () => {
    const keychain = new KeychainStore(
      join(app.getAppPath(), "native/keychain-helper"),
    );
    const repo = await SqliteRepository.open(
      join(app.getPath("userData"), "store", "signals.sqlite"),
      join(__dirname, "sql-wasm.wasm"),
      join(app.getPath("desktop"), "微信语音转写"),
    );
    const reader = new GreenBubblesAdapter(
      createGreenBubblesRunner(
        process.env.GREENBUBBLES_BIN ||
          join(app.getAppPath(), "vendor/greenbubbles/greenbubbles"),
      ),
      (identity) => repo.bindSource(identity),
      voiceMaterializer(
        join(app.getAppPath(), "vendor/greenbubbles/greenbubbles"),
        join(app.getAppPath(), "vendor/greenbubbles/greenbubbles-acquire"),
        join(app.getAppPath(), "vendor/speech/ffmpeg"),
      ),
      voiceMaterializer(
        join(app.getAppPath(), "vendor/greenbubbles/greenbubbles"),
        join(app.getAppPath(), "vendor/greenbubbles/greenbubbles-acquire"),
        join(app.getAppPath(), "vendor/speech/ffmpeg"),
        { kind: "image" },
      ),
    );
    const plugin = new GreenBubblesPlugin(
      reader,
      createPreflightProbe(
        join(app.getAppPath(), "vendor/greenbubbles/greenbubbles-acquire"),
      ),
    );
    const speech = new LocalSpeechTranscriber(
      join(app.getAppPath(), "vendor/speech"),
      join(app.getPath("userData"), "speech-temp"),
    );
    const background = new BackgroundSpeech(reader, repo, speech);
    const service = new ApplicationService(
      plugin.reader,
      new JevAnalysisService(
        keychain,
        fetch,
        () => repo.getJevModel(),
        () => repo.getSettings().jevConsistency === true,
      ),
      repo,
      plugin,
      speech,
      new LocalImageRecognizer(
        join(app.getAppPath(), "native/image-ocr"),
        join(app.getPath("userData"), "image-temp"),
        join(app.getAppPath(), "vendor/speech/ffmpeg"),
      ),
    );
    const window = new BrowserWindow({
      width: 1180,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: "微信聊天信号",
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const handlers: Record<string, (...args: any[]) => unknown> = {
      evidenceContext: (id, analysisId, segment, metric, side) => service.evidenceContext(validId(id),validId(analysisId),z.number().int().min(0).max(50000).parse(segment),z.enum(["romantic_interest","initiative","emotional_investment","closeness","flirting"]).parse(metric),z.enum(["support","counter"]).parse(side)),
      editImageText: (id,messageId,text) => service.editImageText(validId(id),validId(messageId),z.string().max(10000).parse(text)),
      evaluationReport: async () => {
        try {
          const r = JSON.parse(
            await readFile(
              join(app.getAppPath(), "evaluation/results/latest.json"),
              "utf8",
            ),
          );
          const n = z.number().int().nonnegative();
          const summary = z.object({
            cases: n,
            labels: n,
            correct: n,
            failedCases: n,
            checked: n,
            stable: n,
            falsePositive: n,
            negativeLabels: n,
            missed: n,
            positiveLabels: n,
            coverage:z.number().min(0).max(1).nullable().optional(),
            perCategory:z.record(z.string(),z.object({labels:n,correct:n,falsePositive:n,negativeLabels:n,missed:n,positiveLabels:n,abstained:n,missing:n,cases:n,failedCases:n})).optional(),
          });
          const report = z
            .object({
              createdAt: z.string(),
              model: z.string(),
              rubricVersion: z.string(),
              dataType: z.enum(["authored-synthetic","independent-deidentified"]),
              independentAnnotation: z.boolean().optional(),
              overall: summary,
              holdout: summary,
            })
            .parse(r);
          return {
            createdAt: report.createdAt,
            model: report.model,
            rubricVersion: report.rubricVersion,
            cases: report.overall.cases,
            labels: report.overall.labels,
            correct: report.overall.correct,
            holdoutLabels: report.holdout.labels,
            holdoutCorrect: report.holdout.correct,
            failed: report.overall.failedCases,
            checked: report.overall.checked,
            stable: report.overall.stable,
            falsePositive: report.overall.falsePositive,
            negativeLabels: report.overall.negativeLabels,
            missed: report.overall.missed,
            positiveLabels: report.overall.positiveLabels,
            localLabels: repo.behaviorLabelCount(),
            coverage: report.overall.coverage,
            perCategory: report.overall.perCategory,
            dataType:report.dataType,
            independentAnnotation:report.independentAnnotation,
          };
        } catch {
          return null;
        }
      },
      labelBehavior: (id, index, behavior, expected) => {
        const key = z.string().parse(behavior);
        if (!(key in behaviorDefinitions)) throw new Error("未知行为标签");
        return repo.labelBehavior(
          validId(id),
          z.number().int().min(0).max(50000).parse(index),
          key,
          z
            .enum(["absent", "weak", "clear", "strong", "unclear"])
            .parse(expected),
        );
      },
      settings: () => repo.getSettings(),
      saveSettings: async (value) => {
        const settings = settingsSchema.parse(value);
        await background.stop();
        repo.setSettings(settings);
        if (settings.autoTranscribe) background.resume();
        return settings;
      },
      backgroundStatus: () => background.status(),
      pauseBackground: () => background.stop(),
      resumeBackground: () => background.resume(),
      refreshView: (id) => service.refreshView(validId(id)),
      status: () => service.status(),
      connection: () => service.connection(),
      openWechatSetup: async () => {
        const error = await shell.openPath(
          join(app.getAppPath(), "ConnectWechat.command"),
        );
        if (error) throw new Error("无法打开本机连接助手");
      },
      conversations: () => service.list(),
      openTranscriptFolder: async () => {
        const status = repo.syncTranscriptFolder();
        if (status.error) return { error: true };
        const error = await shell.openPath(
          join(app.getPath("desktop"), "微信语音转写"),
        );
        return { error: !!error };
      },
      openJevWebsite: (destination) => {
        const target = z.enum(["home", "console"]).parse(destination);
        return shell.openExternal(
          target === "home"
            ? "https://typesafe.ai/"
            : "https://console.typesafe.ai/",
        );
      },
      startRead: (id, range, resume) =>
        service.startRead(
          validId(id),
          z
            .object({
              since: z.number().int().nonnegative().optional(),
              until: z.number().int().nonnegative(),
              label: z.string().max(100),
            })
            .parse(range),
          resume === true,
        ),
      job: (id) => service.job(validId(id)),
      cancelJob: (id) => service.cancelJob(validId(id)),
      startMediaRecognition: (id, retry, upgrade) =>
        service.startMediaRecognition(validId(id), retry === true, upgrade === true),
      previewPlan: (id) => service.previewPlan(validId(id)),
      previewBatch: (token, index) =>
        service.previewBatch(
          validId(token),
          z.number().int().nonnegative().parse(index),
        ),
      startAnalysis: (id, token) =>
        service.startAnalysis(validId(id), validId(token)),
      open: (id) => service.open(validId(id)),
      preview: (id) => service.preview(validId(id)),
      analyze: (id, state) => {
        if (typeof state !== "string" || state.length > 100000)
          throw new Error("无效预览");
        return service.analyze(validId(id), state);
      },
      hasKey: async () => !!(await keychain.get()),
      saveKey: (key) => {
        if (typeof key !== "string") throw new Error("无效 Key");
        return keychain.set(key);
      },
      deleteKey: () => keychain.delete(),
      jevModel: () => repo.getJevModel(),
      setJevModel: (model) =>
        repo.setJevModel(z.enum(["jev-latest", "jev-1.13.0"]).parse(model)),
      startTranscription: (id, messageId, mode, concurrency) => {
        if (background.running) throw new Error("请先暂停后台转写，再手动重试");
        return service.startTranscription(
          validId(id),
          messageId === undefined ? undefined : validMessageId(messageId),
          z.enum(["fast", "accurate"]).default("fast").parse(mode),
          z
            .union([
              z.literal(2),
              z.literal(4),
              z.literal(6),
              z.literal(8),
              z.literal(12),
              z.literal(16),
              z.literal(20),
            ])
            .default(4)
            .parse(concurrency),
        );
      },
      editTranscript: (id, messageId, text) =>
        service.editTranscript(
          validId(id),
          validMessageId(messageId),
          z.string().max(10000).parse(text),
        ),
    };
    for (const [name, handler] of Object.entries(handlers))
      ipcMain.handle(name, async (event, ...args) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("未授权的调用");
        return handler(...args);
      });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (e) => e.preventDefault());
    await window.loadFile(join(__dirname, "index.html"));
    const backgroundTimer = setInterval(() => {
      if (!service.isBusy) background.tick(repo.getSettings());
    }, 3000);
    background.tick(repo.getSettings());
    let quitting = false;
    app.on("before-quit", (event) => {
      if (quitting) return;
      event.preventDefault();
      clearInterval(backgroundTimer);
      void background.shutdown().finally(() => {
        quitting = true;
        repo.close();
        app.quit();
      });
    });
  })
  .catch(() => {
    app.quit();
  });
function validMessageId(id: unknown) {
  // GreenBubbles message selectors are opaque encoded tokens, longer than contact IDs.
  return z.string().min(1).max(2048).parse(id);
}
function validId(id: unknown) {
  if (
    typeof id !== "string" ||
    !id.length ||
    id.length > 256 ||
    /[\r\n\0]/.test(id)
  )
    throw new Error("无效会话");
  return id;
}
app.on("window-all-closed", () => app.quit());
