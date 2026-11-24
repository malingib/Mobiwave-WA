export type WorkspaceUiState = {
  tenantId?: string;
  selectedConversation?: string;
  statusFilter?: string;
  assigneeFilter?: string;
  contactPage?: number;
};

const STORAGE_KEY = "mobiwave-wa:workspace-ui";

export function readWorkspaceUiState(): WorkspaceUiState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const state = value as Record<string, unknown>;
    return {
      ...(typeof state.tenantId === "string" ? { tenantId: state.tenantId } : {}),
      ...(typeof state.selectedConversation === "string" ? { selectedConversation: state.selectedConversation } : {}),
      ...(typeof state.statusFilter === "string" ? { statusFilter: state.statusFilter } : {}),
      ...(typeof state.assigneeFilter === "string" ? { assigneeFilter: state.assigneeFilter } : {}),
      ...(typeof state.contactPage === "number" && Number.isFinite(state.contactPage) ? { contactPage: state.contactPage } : {}),
    };
  } catch {
    return {};
  }
}

export function writeWorkspaceUiState(state: WorkspaceUiState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }
}

export function clearWorkspaceUiState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Clearing transient UI state must not block sign-out.
  }
}

export async function withTimeout<T>(
  operation: PromiseLike<T>,
  label = "Request",
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + " timed out. Check your connection and retry.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
