"use client";
import * as React from "react";
import { InferenceControl } from "@/components/dsh/inference-control";
import { DEFAULT_INFERENCE, type InferenceSettings } from "@/lib/dsh/inference";

import { IconChevronRight, IconLoader2, IconPlus, IconPaperclip as PaperclipIcon } from "@tabler/icons-react";
import { toast } from "sonner";

import { AssetInterceptRulesEditor } from "@/components/asset-intercept-rules-editor";
import { StatusBadge } from "@/components/status-badge";
import { TaskLLMProfileChain } from "@/components/task-llm-profile-chain";
import { TaskTemplateControls } from "@/components/task-template-controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { AssetInterceptRuleInput, ChatAttachment, Company, LLMProfile, Task, TaskCategory } from "@/lib/types";

function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

const UPLOAD_MARKER = "【上传文件（绝对路径）】";

function appendUploads(desc: string, atts: ChatAttachment[]): string {
  const bullets = atts.map((a) => `- ${a.abs ?? a.path}（${fmtBytes(a.size)}）`).join("\n");
  if (desc.includes(UPLOAD_MARKER)) {
    return `${desc.replace(/\s*$/, "")}\n${bullets}\n`;
  }
  const head = desc.trim() ? `${desc.replace(/\s*$/, "")}\n\n` : "";
  return `${head}${UPLOAD_MARKER} worker 可用 Read/Bash 按路径打开：\n${bullets}\n`;
}

const MAX_SOURCE_TASKS = 8;

function SourceTaskPicker({
  tasks,
  value,
  onValueChange,
  portalContainer,
}: {
  tasks: Task[];
  value: string[];
  onValueChange: (value: string[]) => void;
  portalContainer?: React.RefObject<HTMLElement | null>;
}) {
  const tasksByID = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const taskIDs = React.useMemo(() => tasks.map((task) => task.id), [tasks]);
  const atLimit = value.length >= MAX_SOURCE_TASKS;

  const handleValueChange = (next: string[]) => {
    onValueChange(next.slice(0, MAX_SOURCE_TASKS));
  };

  return (
    <Combobox
      items={taskIDs}
      itemToStringValue={(taskID) => {
        const task = tasksByID.get(taskID);
        return task ? `${task.id} ${task.description} ${task.goal}` : taskID;
      }}
      multiple
      value={value}
      onValueChange={handleValueChange}
    >
      <ComboboxChips>
        <ComboboxValue>
          {value.map((taskID) => (
            <ComboboxChip key={taskID}>#{taskID}</ComboboxChip>
          ))}
        </ComboboxValue>
        <ComboboxChipsInput
          id="source-tasks"
          placeholder={atLimit ? `最多关联 ${MAX_SOURCE_TASKS} 个任务` : "搜索任务 ID、描述或目标"}
          disabled={atLimit}
        />
      </ComboboxChips>
      <ComboboxContent portalContainer={portalContainer}>
        <ComboboxEmpty>没有匹配的任务</ComboboxEmpty>
        <ComboboxList>
          {(taskID) => {
            const task = tasksByID.get(taskID);
            return (
              <ComboboxItem key={taskID} value={taskID} disabled={atLimit && !value.includes(taskID)}>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">
                      #{taskID} · {task?.description ?? "未知任务"}
                    </p>
                    {task?.goal && <p className="truncate text-muted-foreground text-xs">{task.goal}</p>}
                  </div>
                  {task && <StatusBadge domain="task" value={task.status} />}
                </div>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function CategoryPicker({
  categories,
  value,
  onValueChange,
  onCategoryCreated,
  portalContainer,
}: {
  categories: TaskCategory[];
  value?: number;
  onValueChange: (categoryID?: number) => void;
  onCategoryCreated: () => void;
  portalContainer?: React.RefObject<HTMLElement | null>;
}) {
  const [inputValue, setInputValue] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  // 新建的分类要等父层重新拉取才回流到 categories，先本地留一份，避免选中的 chip 和
  // 下拉在这段窗口里显示成「未知分类」。
  const [localExtra, setLocalExtra] = React.useState<TaskCategory[]>([]);

  const allCategories = React.useMemo(() => {
    const byID = new Map<number, TaskCategory>();
    for (const category of categories) byID.set(category.id, category);
    for (const category of localExtra) if (!byID.has(category.id)) byID.set(category.id, category);
    return [...byID.values()];
  }, [categories, localExtra]);

  const byID = React.useMemo(() => new Map(allCategories.map((c) => [String(c.id), c])), [allCategories]);
  const categoryIDs = React.useMemo(() => allCategories.map((c) => String(c.id)), [allCategories]);
  const selectedIDs = value != null ? [String(value)] : [];

  const trimmed = inputValue.trim();
  const lower = trimmed.toLowerCase();
  // 与 base-ui 默认子串过滤保持一致，用来判断「有没有相关分类」。
  const matchCount = trimmed
    ? allCategories.filter((c) => c.name.toLowerCase().includes(lower)).length
    : allCategories.length;

  const createAndSelect = async () => {
    if (!trimmed || creating) return;
    // 精确同名已存在则直接选中，不重复创建。
    const existing = allCategories.find((c) => c.name.toLowerCase() === lower);
    if (existing) {
      onValueChange(existing.id);
      setInputValue("");
      return;
    }
    setCreating(true);
    try {
      const created = await api.createTaskCategory(trimmed);
      setLocalExtra((prev) => [...prev, created]);
      onValueChange(created.id);
      setInputValue("");
      onCategoryCreated();
      toast.success(`已创建分类「${created.name}」`);
    } catch (e) {
      toast.error(`创建分类失败：${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Combobox
      items={categoryIDs}
      itemToStringValue={(id) => byID.get(id)?.name ?? id}
      multiple
      value={selectedIDs}
      onValueChange={(next: string[]) => {
        // 单选：取最新选中的一个；移除 chip（清空）则回到未分类。
        const last = next[next.length - 1];
        onValueChange(last ? Number(last) : undefined);
        setInputValue("");
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
    >
      <ComboboxChips>
        <ComboboxValue>
          {selectedIDs.map((id) => (
            <ComboboxChip key={id}>{byID.get(id)?.name ?? "未知分类"}</ComboboxChip>
          ))}
        </ComboboxValue>
        <ComboboxChipsInput
          id="task-category"
          placeholder={selectedIDs.length ? "" : "搜索分类，或输入新名称后回车创建"}
          onKeyDown={(e) => {
            // 完全无匹配时回车 = 创建；有匹配项时保留 base-ui 的「回车选中高亮项」。
            if (e.key === "Enter" && matchCount === 0 && trimmed) {
              e.preventDefault();
              void createAndSelect();
            }
          }}
        />
      </ComboboxChips>
      <ComboboxContent portalContainer={portalContainer}>
        <ComboboxList>
          {(id: string) => (
            <ComboboxItem key={id} value={id}>
              {byID.get(id)?.name ?? id}
            </ComboboxItem>
          )}
        </ComboboxList>
        {matchCount === 0 &&
          (trimmed ? (
            <button
              type="button"
              disabled={creating}
              onClick={() => void createAndSelect()}
              className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {creating ? <Spinner className="size-4" /> : <IconPlus className="size-4" />}
              创建分类「{trimmed}」
            </button>
          ) : (
            <div className="px-2 py-2 text-muted-foreground text-sm">输入名称以搜索或创建分类</div>
          ))}
      </ComboboxContent>
    </Combobox>
  );
}

const COMPANY_SCOPE_LABELS: Record<string, string> = {
  domain: "域名",
  ip: "IP",
  cidr: "CIDR",
  icp: "ICP",
  keyword: "关键词",
};

function companyScopeSummary(company: Company): string {
  const rows = company.scope ?? [];
  if (rows.length === 0) return "未配置资产范围";
  const preview = rows.slice(0, 3).map((row) => {
    const value = row.raw || row.value || row.domain || row.net || "";
    return `${COMPANY_SCOPE_LABELS[row.kind] ?? row.kind}：${value}`;
  });
  return `${preview.join(" · ")}${rows.length > preview.length ? ` · 另 ${rows.length - preview.length} 条` : ""}`;
}

function CompanyPicker({
  companies,
  value,
  onValueChange,
  portalContainer,
}: {
  companies: Company[];
  value: number[];
  onValueChange: (value: number[]) => void;
  portalContainer?: React.RefObject<HTMLElement | null>;
}) {
  const companiesByID = React.useMemo(
    () => new Map(companies.map((company) => [String(company.id), company])),
    [companies],
  );
  const companyIDs = React.useMemo(() => companies.map((company) => String(company.id)), [companies]);
  const selectedIDs = React.useMemo(() => value.map(String), [value]);

  return (
    <Combobox
      items={companyIDs}
      itemToStringValue={(companyID) => {
        const company = companiesByID.get(companyID);
        return company ? `${company.name} ${companyScopeSummary(company)}` : companyID;
      }}
      multiple
      value={selectedIDs}
      onValueChange={(next) => onValueChange(next.map(Number).filter(Number.isFinite))}
    >
      <ComboboxChips>
        <ComboboxValue>
          {selectedIDs.map((companyID) => (
            <ComboboxChip key={companyID}>{companiesByID.get(companyID)?.name ?? `企业 #${companyID}`}</ComboboxChip>
          ))}
        </ComboboxValue>
        <ComboboxChipsInput id="task-companies" placeholder="搜索企业名称或资产范围" />
      </ComboboxChips>
      <ComboboxContent portalContainer={portalContainer}>
        <ComboboxEmpty>没有匹配的企业</ComboboxEmpty>
        <ComboboxList>
          {(companyID) => {
            const company = companiesByID.get(companyID);
            return (
              <ComboboxItem key={companyID} value={companyID}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{company?.name ?? `企业 #${companyID}`}</span>
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {company?.asset_count ?? 0} 个资产
                    </span>
                  </div>
                  {company && (
                    <span className="truncate text-muted-foreground text-xs" title={companyScopeSummary(company)}>
                      {companyScopeSummary(company)}
                    </span>
                  )}
                </div>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function TaskCreateForm({
  tasks,
  categories,
  onCreated,
  onCategoriesChanged,
  conversationId,
  ensureConversation,
  initialDescription = "",
  defaultProfileId,
  initialInference,
  onCancel,
}: {
  tasks: Task[];
  categories: TaskCategory[];
  onCreated: (task: Task) => void | Promise<void>;
  conversationId?: number;
  ensureConversation?: () => Promise<number>;
  initialDescription?: string;
  defaultProfileId?: number;
  initialInference?: InferenceSettings;
  onCancel?: () => void;
  onCategoriesChanged: () => void;
}) {
  const [name, setName] = React.useState("");
  const [categoryID, setCategoryID] = React.useState<number | undefined>(undefined);
  const [description, setDescription] = React.useState(initialDescription);
  const [goal, setGoal] = React.useState("");
  const [selectedTemplateID, setSelectedTemplateID] = React.useState<number | null>(null);
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [taskDefaultProfileId, setTaskDefaultProfileId] = React.useState<number>();
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [sourceTaskIDs, setSourceTaskIDs] = React.useState<string[]>([]);
  const [companyIDs, setCompanyIDs] = React.useState<number[]>([]);
  const [llmProfileIDs, setLLMProfileIDs] = React.useState<string[]>(
    defaultProfileId ? [String(defaultProfileId)] : [],
  );
  const [inference, setInference] = React.useState<InferenceSettings>(initialInference ?? DEFAULT_INFERENCE);
  const [creating, setCreating] = React.useState(false);
  const [timeoutMin, setTimeoutMin] = React.useState(""); // 任务级超时(分钟);空/0 = 不限时
  const [heartbeatMin, setHeartbeatMin] = React.useState("10"); // planner 心跳(分钟);默认10,下限10(与后端一致)
  const [seedFirstIntent, setSeedFirstIntent] = React.useState(false); // 创建时下发种子意图,worker 免等首轮 planner 直接开跑;默认关闭,走标准先规划再执行
  const [coverageEnabled, setCoverageEnabled] = React.useState(true); // 资产覆盖度功能;默认开。关闭=不计算/展示覆盖度、不累积范围、隐藏范围类工具(company 关联不受影响)
  const [interceptRules, setInterceptRules] = React.useState<AssetInterceptRuleInput[]>([]); // 任务级资产拦截规则(仅本任务生效,不进全局表)
  // 方式1 文件上传:建任务前把文件暂存到 drafts/<draftId>/uploads/,拿回绝对路径追加进描述。
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);
  const draftIdRef = React.useRef<string>("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const sheetContentRef = React.useRef<HTMLDivElement>(null);

  const draftKey = `artex:task-draft:${conversationId ?? "new"}`;
  const [draftReady, setDraftReady] = React.useState(false);
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (saved) {
        setInference(saved.inference ?? initialInference ?? DEFAULT_INFERENCE);
        setName(saved.name ?? "");
        setDescription(saved.description ?? initialDescription);
        setGoal(saved.goal ?? "");
        setCategoryID(saved.categoryID);
        setSourceTaskIDs(saved.sourceTaskIDs ?? []);
        setCompanyIDs(saved.companyIDs ?? []);
        setLLMProfileIDs(saved.llmProfileIDs ?? (defaultProfileId ? [String(defaultProfileId)] : []));
        setTimeoutMin(saved.timeoutMin ?? "");
        setHeartbeatMin(saved.heartbeatMin ?? "10");
        setSeedFirstIntent(saved.seedFirstIntent ?? false);
        setCoverageEnabled(saved.coverageEnabled ?? true);
        setInterceptRules(saved.interceptRules ?? []);
      }
    } catch {
      /* Corrupt or unavailable local storage/URL leaves the current defaults intact. */
    }
    setDraftReady(true);
  }, [draftKey, initialDescription, defaultProfileId]);
  React.useEffect(() => {
    if (!draftReady) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          name,
          description,
          goal,
          categoryID,
          sourceTaskIDs,
          companyIDs,
          llmProfileIDs,
          inference,
          timeoutMin,
          heartbeatMin,
          seedFirstIntent,
          coverageEnabled,
          interceptRules,
        }),
      );
    } catch {
      /* Corrupt or unavailable local storage/URL leaves the current defaults intact. */
    }
  }, [
    draftReady,
    draftKey,
    name,
    description,
    goal,
    categoryID,
    sourceTaskIDs,
    companyIDs,
    llmProfileIDs,
    inference,
    timeoutMin,
    heartbeatMin,
    seedFirstIntent,
    coverageEnabled,
    interceptRules,
  ]);
  // load LLM profiles once for the create-task profile picker.
  React.useEffect(() => {
    api
      .llmProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
    api
      .agents()
      .then((agents) => setTaskDefaultProfileId(agents.find((a) => a.key === "mainagent")?.llm_profile_id ?? undefined))
      .catch(() => setTaskDefaultProfileId(undefined));
    api
      .companies()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, []);

  // pickFiles uploads the chosen files into this draft's staging dir and appends their
  // absolute paths to the description; the task's agents open them by path via Read/Bash.
  async function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // crypto.randomUUID 仅在安全上下文可用(https/localhost);经 IP+http 访问时降级。
    if (!draftIdRef.current) {
      draftIdRef.current =
        globalThis.crypto?.randomUUID?.() ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    }
    setUploading(true);
    try {
      const r = await api.chatUpload("staging", draftIdRef.current, Array.from(files));
      setDescription((prev) => appendUploads(prev, r.attachments));
      setUploadCount((n) => n + r.attachments.length);
    } catch (e) {
      toast.error(`上传失败：${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = ""; // allow re-picking the same file
    }
  }

  async function createTask() {
    if (!description.trim() || !goal.trim()) {
      toast.error("请填写描述与目标");
      return;
    }
    if (sourceTaskIDs.length > MAX_SOURCE_TASKS) {
      toast.error(`最多关联 ${MAX_SOURCE_TASKS} 个来源任务`);
      return;
    }
    setCreating(true);
    try {
      const timeoutSec = Math.max(0, Math.floor(Number(timeoutMin) || 0)) * 60;
      const heartbeatSec = Math.max(10, Math.floor(Number(heartbeatMin) || 10)) * 60; // 下限 10min，与后端归一一致
      const boundConversationId = conversationId ?? (await ensureConversation?.());
      const task = await api.createTask({
        inference: {
          ...inference,
          profile_id: Number(llmProfileIDs[0]) || null,
          explicit_model: llmProfileIDs.length > 0,
        },
        conversationId: boundConversationId,
        name: name.trim(),
        categoryId: categoryID,
        description: description.trim(),
        goal: goal.trim(),
        llmProfileIds: llmProfileIDs.map(Number),
        sourceTaskIds: sourceTaskIDs,
        companyIds: companyIDs,
        timeoutSeconds: timeoutSec,
        seedFirstIntent,
        planHeartbeatSeconds: heartbeatSec,
        coverageEnabled,
        interceptRules: interceptRules
          .map((r) => ({ ...r, pattern: r.pattern.trim() }))
          .filter((r) => r.pattern !== ""),
      });
      await onCreated(task);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* Corrupt or unavailable local storage/URL leaves the current defaults intact. */
      }
      toast.success("任务已创建并开始执行");
      setName("");
      setCategoryID(undefined);
      setDescription("");
      setGoal("");
      setSelectedTemplateID(null);
      setSourceTaskIDs([]);
      setCompanyIDs([]);
      setLLMProfileIDs([]);
      setInference(DEFAULT_INFERENCE);
      setTimeoutMin("");
      setHeartbeatMin("10");
      setSeedFirstIntent(false);
      setCoverageEnabled(true);
      setInterceptRules([]);
      setUploadCount(0);
      draftIdRef.current = "";
    } catch (e) {
      toast.error(`创建失败：${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="dsh-task-draft" aria-label="任务草案">
      <header className="border-b p-5">
        <h2 className="font-semibold text-base">创建并执行任务</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          确认目标后执行，结果和后续对话留在这里。已有对话会作为上下文保留。
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-5">
          <TaskTemplateControls
            description={description}
            goal={goal}
            categoryID={categoryID}
            interceptRules={interceptRules}
            selectedTemplateID={selectedTemplateID}
            onSelectedTemplateIDChange={setSelectedTemplateID}
            onApply={(template) => {
              setDescription(template.description);
              setGoal(template.goal);
              setCategoryID(template.category_id ?? undefined);
              setInterceptRules(template.intercept_rules ?? []);
              setUploadCount(0);
            }}
            portalContainer={sheetContentRef}
          />
          <div className="grid gap-2">
            <Label htmlFor="name">名称（可选）</Label>
            <Input
              id="name"
              placeholder="给任务起个便于识别的名字，例如：Acme 官网渗透"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Field>
            <FieldLabel htmlFor="task-category">任务分类</FieldLabel>
            <CategoryPicker
              categories={categories}
              value={categoryID}
              onValueChange={setCategoryID}
              onCategoryCreated={onCategoriesChanged}
              portalContainer={sheetContentRef}
            />
            <FieldDescription>可选，单个分类；用于任务列表筛选和归档，不影响 Agent 执行。</FieldDescription>
          </Field>
          <div className="grid gap-2">
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              className="min-h-32"
              placeholder="测试对象与背景，例如：测试 example.com 这个站点"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {/* 上传文件(可多选):暂存到 drafts/,把绝对路径追加进上方描述,worker 据此 Read/Bash 打开。 */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void pickFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <IconLoader2 className="animate-spin" /> : <PaperclipIcon />}
                上传文件
              </Button>
              <span className="text-muted-foreground text-xs">
                {uploadCount > 0
                  ? `已上传 ${uploadCount} 个文件，绝对路径已追加到描述末尾（可编辑）`
                  : "可多选；上传后把文件的绝对路径追加到描述，供 worker 用 Read/Bash 打开"}
              </span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal">目标</Label>
            <Textarea
              id="goal"
              className="min-h-32"
              placeholder="要达成什么，例如：拿下后台管理权限、获取服务器权限"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center gap-2 border-t pt-4 font-medium text-sm">
              <IconChevronRight className="size-4" />
              任务配置 · 模型、关联范围与高级参数
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-5 pt-4">
              <Field>
                <FieldLabel htmlFor="source-tasks">关联任务</FieldLabel>
                <SourceTaskPicker
                  tasks={tasks}
                  value={sourceTaskIDs}
                  onValueChange={setSourceTaskIDs}
                  portalContainer={sheetContentRef}
                />
                <FieldDescription>
                  最多关联 {MAX_SOURCE_TASKS}{" "}
                  个任务。实时只读继承所选任务的持久化黑板、资产范围及相关流量；新任务写入独立黑板。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-companies">关联企业资产范围</FieldLabel>
                <CompanyPicker
                  companies={companies}
                  value={companyIDs}
                  onValueChange={setCompanyIDs}
                  portalContainer={sheetContentRef}
                />
                <FieldDescription>
                  创建任务时会将所选企业当前已有资产加入“测试资产”，并将域名、IP、CIDR、ICP 和企业关键词提供给 Agent
                  作为范围上下文；不会自动生成意图或强制改变执行目标。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-intercept-rules">任务级资产拦截 / 允许规则（可选）</FieldLabel>
                <AssetInterceptRulesEditor value={interceptRules} onChange={setInterceptRules} />
                <FieldDescription>
                  仅对本任务生效，不写入全局规则。判定顺序：先按「拦截」规则（含全局）匹配，命中即禁止测试；未命中且本任务配置了「允许」规则时，须命中某条允许规则才放行，否则同样不允许测试；未配置任何允许规则则不启用白名单。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="llm-profiles">LLM 配置链</FieldLabel>
                <TaskLLMProfileChain
                  profiles={profiles}
                  value={llmProfileIDs}
                  onValueChange={(ids) => {
                    if (ids[0] !== llmProfileIDs[0]) setInference(DEFAULT_INFERENCE);
                    setLLMProfileIDs(ids);
                  }}
                  inputId="llm-profiles"
                  portalContainer={sheetContentRef}
                />
                <FieldDescription>
                  按列表顺序故障转移；第一项为当前配置，仅在明确额度不足时切换下一项。
                </FieldDescription>
              </Field>

              {/* 高级参数默认折叠:超时/心跳/首个意图,展开才占空间,常用路径保持清爽。 */}
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center gap-2 border-t pt-4 font-medium text-sm">
                  <IconChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                  高级设置
                  <span className="ml-auto font-normal text-muted-foreground text-xs">超时 · 心跳 · 首个意图</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="grid gap-5 pt-5">
                  <div className="grid gap-2">
                    <Label htmlFor="timeout-min">任务超时（分钟，可选）</Label>
                    <Input
                      id="timeout-min"
                      type="number"
                      min={0}
                      className="w-40"
                      placeholder="留空 = 不限时"
                      value={timeoutMin}
                      onChange={(e) => setTimeoutMin(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">
                      到点后触发优雅收尾（各 agent 写回 + planner 终局判定），任务进入 timeout 终态。
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="heartbeat-min">planner 心跳（分钟）</Label>
                    <Input
                      id="heartbeat-min"
                      type="number"
                      min={10}
                      className="w-40"
                      placeholder="默认 10"
                      value={heartbeatMin}
                      onChange={(e) => setHeartbeatMin(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">
                      距上轮规划结束/任务开始满该时长且期间无触发，自动触发一轮规划（兜底卡死 + 唤醒去监督在跑的
                      worker）。下限 10 分钟。
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <label htmlFor="seed-first-intent" className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id="seed-first-intent"
                        checked={seedFirstIntent}
                        onCheckedChange={(v) => setSeedFirstIntent(!!v)}
                      />
                      直接下发首个意图（描述+目标）
                    </label>
                    <p className="text-muted-foreground text-xs">
                      开启后创建即把「描述+目标」作为一条意图下发，worker 免等首轮规划直接开跑，跑完再由 planner
                      接手判定/补充。CTF 等常一个 work 直接解决的场景推荐开启；关闭则走标准的先规划再执行。
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <label htmlFor="coverage-enabled" className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id="coverage-enabled"
                        checked={coverageEnabled}
                        onCheckedChange={(v) => setCoverageEnabled(!!v)}
                      />
                      资产覆盖度功能
                    </label>
                    <p className="text-muted-foreground text-xs">
                      默认开启：计算并展示测试覆盖度、态势图显示测试进度、自动累积测试范围。关闭后不再计算/展示覆盖度，
                      态势图仅展示资产不显示进度，agent 也不再获得范围类工具。关闭不影响「关联企业资产范围」。
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      <div className="border-t px-2 py-1">
        {" "}
        <InferenceControl
          scope="task"
          profiles={profiles}
          defaultProfileId={taskDefaultProfileId}
          draft={{
            ...inference,
            profile_id: Number(llmProfileIDs[0]) || null,
            explicit_model: llmProfileIDs.length > 0,
          }}
          onDraftChange={(value) => {
            setInference(value);
            setLLMProfileIDs(
              value.profile_id
                ? [String(value.profile_id), ...llmProfileIDs.filter((v) => v !== String(value.profile_id))]
                : [],
            );
          }}
          disabled={creating}
        />
      </div>
      <footer className="flex justify-end gap-2 border-t p-4">
        <Button variant="outline" onClick={onCancel} disabled={creating}>
          返回对话
        </Button>

        <Button onClick={createTask} disabled={creating || uploading || !draftReady}>
          {creating && <Spinner data-icon="inline-start" />}
          {creating ? "正在创建并执行…" : "创建并执行"}
        </Button>
      </footer>
    </section>
  );
}
