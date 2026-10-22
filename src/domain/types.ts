export type Contact = {
  id: string;
  displayName: string;
  aliases: string[];
  isMe: boolean;
  kind: string;
};
export type Conversation = {
  id: string;
  displayName: string;
  updatedAt: number;
};
export type Message = {
  id: string;
  conversationId: string;
  sender: "me" | "other" | "unknown";
  timestamp: number;
  text: string;
  kind: "text" | "voice" | "emoji" | "image" | "video" | "rich" | "unsupported";
  transcript?: string;
  transcriptReviewed?: boolean;
  media?: MediaObservation;
  voiceError?: import("./voice-errors").VoiceErrorCode;
};
export type MediaObservation = {
  version: "vision-ocr-v1" | "vision-local-v2";
  reviewed?: boolean;
  labels?: { name: string; confidence: number }[];
  barcodeCount?: number;
  width?: number;
  height?: number;
  frameCount?: number;
  classificationAvailable?: boolean;
  status: "recognized" | "no_text" | "unavailable";
  text: string;
  confidence: number | null;
};
export type ReaderStatus = { readable: boolean; code: string; detail: string };
export interface WechatReader {
  detect(): Promise<ReaderStatus>;
  listContacts(): Promise<Contact[]>;
  listConversations(): Promise<Conversation[]>;
  getMessages(conversationId: string, limit?: number): Promise<Message[]>;
  getMessagePage?(id: string, query: PageQuery): Promise<MessagePage>;
  materializeVoice?(
    id: string,
    messageId: string,
    output: string,
    signal?: AbortSignal,
  ): Promise<string>;
  materializeImage?(
    id: string,
    messageId: string,
    output: string,
    signal?: AbortSignal,
  ): Promise<string>;
}
export const metricLabels = {
  romantic_interest: "好感信号",
  initiative: "主动程度",
  emotional_investment: "情绪投入",
  closeness: "亲密程度",
  flirting: "暧昧信号",
} as const;
export type Metric = keyof typeof metricLabels;
export type EvidenceQuality = "sufficient" | "limited" | "insufficient";
export type EvidenceExcerpt = {
  messages: { speaker: "Me" | "Person A"; text: string }[];
  targetStart: number;
  targetEnd: number;
};
export type MetricResult = {
  composition?: string[];
  score: number;
  confidence: number | null;
  quality?: EvidenceQuality;
  qualityConfidence?: number | null;
  reviewReasons?: string[];
  support?: EvidenceExcerpt | null;
  counter?: EvidenceExcerpt | null;
  summary?: {
    signal?: {
      clearSegments: number;
      friendlySegments: number;
      ambiguousSegments: number;
      ordinarySegments: number;
      boundarySegments: number;
      episodes: number;
      pattern:
        | "isolated"
        | "repeated"
        | "not_observed"
        | "ambiguous"
        | "friendly_only";
      baselineMedian: number;
    };
    eligibleSegments: number;
    totalSegments: number;
    recentScore: number | null;
    previousScore: number | null;
    trend: "rising" | "falling" | "stable" | "insufficient";
    minimum: number | null;
    maximum: number | null;
    reviewSegments?: number;
    insufficientSegments?: number;
  };
};
export type InteractionJudgment = { choice: string; confidence: number; probabilities: Record<string, number> };
export type EvidenceContext = { available: boolean; detail: string; messages: Message[]; targetIds: string[] };
export type Analysis = {
  interactions?: Record<string, InteractionJudgment>;
  aggregationVersion?: string;
  behaviors?: Record<
    string,
    {
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
      stable?: boolean;
      checkChoice?: string;
    }
  >;
  id: string;
  conversationId: string;
  createdAt: number;
  model: string;
  rubricVersion?: string;
  inputCoverage?: {
    total: number;
    omitted: number;
    truncated: number;
    pendingVoice: number;
    modalities?: Record<string, number>;
  };
  messageCount: number;
  metrics: Record<Metric, MetricResult>;
  segments?: AnalysisSegment[];
  status?: "complete" | "partial";
  totalBatches?: number;
  range?: ReadRange;
};
export type Stats = {
  sessions?: number;
  longestActiveStreak?: number;
  activeDays?: number;
  me: SideStats;
  other: SideStats;
  recent7Days: number;
  activeDays7: number;
  sampleCount: number;
};
export type SideStats = {
  count: number;
  starts: number;
  avgReplySeconds: number | null;
  medianReplySeconds?: number | null;
  p90ReplySeconds?: number | null;
  replySamples?: number;
  avgLength: number;
};
export interface AnalysisRepository {
  save(result: Analysis): void;
  latest(id: string): Analysis | null;
  cacheContacts(contacts: Contact[], conversations: Conversation[]): void;
  cacheMessages(id: string, messages: Message[]): void;
  getTranscript?(id: string): string | null;
  getTranscriptReview?(id: string): boolean;
  saveTranscriptReview?(id: string): void;
  saveTranscript?(id: string, text: string): void;
  getMedia?(id: string): MediaObservation | null;
  saveMedia?(id: string, value: MediaObservation): void;
}
export interface SecretStore {
  get(): Promise<string | null>;
  set(key: string): Promise<void>;
  delete(): Promise<void>;
}
export type View = {
  interactions?: import("../application/dialogue-interactions").DialogueInteractions;
  conversation: Conversation;
  messages: Message[];
  stats: Stats;
  analysis: Analysis | null;
  coverage?: ReadCoverage;
  charts?: ChartData;
  contentCoverage?: {
    text: number;
    voice: number;
    transcribed: number;
    imageLegacy?: number;
    images?: number;
    imageOcr?: number;
    imageProcessed?: number;
    imagePending?: number;
    imageUnavailable?: number;
    emoji: number;
    other: number;
    total: number;
  };
};
export type Preview = { state: string; messageCount: number; omitted: number };
export type MessageSearchQuery = {
  text?: string;
  sender?: Message["sender"] | "all";
  kind?: Message["kind"] | "all";
  offset?: number;
};
export type MessageSearchResult = {
  messages: Message[];
  total: number;
  scanned: number;
  offset: number;
  limit: number;
};
export interface DesktopApi {
  searchMessages(id: string, query: MessageSearchQuery): Promise<MessageSearchResult>;
  evidenceContext(id: string, analysisId: string, segment: number, metric: Metric, side: "support" | "counter"): Promise<EvidenceContext>;
  editImageText(id: string, messageId: string, text: string): Promise<View>;
  evaluationReport(): Promise<EvaluationSummary | null>;
  labelBehavior(
    analysisId: string,
    segment: number,
    behavior: string,
    expected: string,
  ): Promise<void>;
  settings(): Promise<import("./settings").AppSettings>;
  saveSettings(
    value: import("./settings").AppSettings,
  ): Promise<import("./settings").AppSettings>;
  backgroundStatus(): Promise<Job | null>;
  pauseBackground(): Promise<void>;
  resumeBackground(): Promise<void>;
  refreshView(id: string): Promise<View | null>;
  status(): Promise<ReaderStatus>;
  connection(): Promise<ConnectionReport>;
  openWechatSetup(): Promise<void>;
  openTranscriptFolder(): Promise<{ error: boolean }>;
  openJevWebsite(destination: "home" | "console"): Promise<void>;
  conversations(): Promise<Conversation[]>;
  open(id: string): Promise<View>;
  startRead(id: string, range: ReadRange, resume?: boolean): Promise<Job>;
  job(id: string): Promise<Job>;
  cancelJob(id: string): Promise<void>;
  previewPlan(id: string): Promise<AnalysisPlan>;
  previewBatch(token: string, index: number): Promise<string>;
  startAnalysis(id: string, token: string): Promise<Job>;
  preview(id: string): Promise<Preview>;
  analyze(id: string, expectedState: string): Promise<Analysis>;
  hasKey(): Promise<boolean>;
  saveKey(key: string): Promise<void>;
  deleteKey(): Promise<void>;
  jevModel(): Promise<string>;
  setJevModel(model: string): Promise<void>;
  startTranscription(
    id: string,
    messageId?: string,
    mode?: "fast" | "accurate",
    concurrency?: number,
  ): Promise<Job>;
  editTranscript(id: string, messageId: string, text: string): Promise<View>;
  startMediaRecognition(id: string, retry?: boolean, upgrade?: boolean): Promise<Job>;
}

export type EvaluationSummary = {
  dataType?: string;
  independentAnnotation?: boolean;
  coverage?: number | null;
  perCategory?: Record<string,{labels:number;correct:number;falsePositive:number;negativeLabels:number;missed:number;positiveLabels:number;abstained:number;missing:number;cases:number;failedCases:number}>;
  createdAt: string;
  model: string;
  rubricVersion: string;
  cases: number;
  labels: number;
  correct: number;
  holdoutLabels: number;
  holdoutCorrect: number;
  failed: number;
  checked: number;
  stable: number;
  falsePositive: number;
  negativeLabels: number;
  missed: number;
  positiveLabels: number;
  localLabels: number;
};

export type ConnectionReport = {
  plugin: string;
  readable: boolean;
  checks: { label: string; ok: boolean }[];
  needsSetup: boolean;
  detail: string;
};
export interface WechatReaderPlugin {
  id: string;
  readOnly: true;
  reader: WechatReader;
  inspectConnection(): Promise<ConnectionReport>;
}

export type ReadRange = { since?: number; until: number; label: string };
export type PageQuery = {
  signal?: AbortSignal;
  since?: number;
  until?: number;
  cursor?: string;
  limit: number;
};
export type MessagePage = {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
  crossDatabaseAtomic: boolean;
};
export type ReadCoverage = {
  range: ReadRange;
  count: number;
  pages: number;
  complete: boolean;
  hasMore: boolean;
  first: number | null;
  last: number | null;
  crossDatabaseAtomic: boolean;
  state: "running" | "complete" | "limited" | "failed" | "cancelled";
};
export type Job = {
  failed?: number;
  skipped?: number;
  failureCounts?: Partial<
    Record<import("./voice-errors").VoiceErrorCode, number>
  >;
  concurrency?: number;
  id: string;
  kind: "read" | "analysis" | "transcription" | "media";
  state: "running" | "complete" | "limited" | "failed" | "cancelled";
  count: number;
  pages: number;
  completedBatches: number;
  totalBatches: number;
  detail: string;
  view?: View;
  analysis?: Analysis;
};
export type BatchSummary = {
  messageIds?: string[];
  splitReason?: string;
  index: number;
  messageCount: number;
  first: number;
  last: number;
  bytes: number;
};
export type AnalysisPlan = {
  segmentationVersion?: string;
  inputCoverage?: {
    total: number;
    omitted: number;
    truncated: number;
    pendingVoice: number;
    modalities?: Record<string, number>;
  };
  token: string;
  messageCount: number;
  omitted: number;
  truncated: number;
  batches: BatchSummary[];
};
export type AnalysisSegment = {
  messageIds?: string[];
  splitReason?: string;
  index: number;
  first: number;
  last: number;
  result: Analysis;
};
export type ChartData = {
  weekdayHourly?: {
    weekday: number;
    hour: number;
    me: number;
    other: number;
  }[];
  daily: { date: string; me: number; other: number }[];
  hourly: { hour: number; me: number; other: number }[];
  replies: { label: string; me: number; other: number }[];
};
