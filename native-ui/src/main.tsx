import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  ConfigProvider,
  Descriptions,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Check,
  CircleHelp,
  CircleSlash,
  Cpu,
  FileCode2,
  HardDrive,
  KeyRound,
  Languages,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Network,
  Pencil,
  Power,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Menu as MenuIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n, { storeLanguage } from "./i18n";
import "./styles.css";

type Theme = "dark" | "light" | "system";
type PluginState = string;
interface LocalSession {
  ok: boolean;
  authenticated: boolean;
  configured: boolean;
  passwordConfigured: boolean;
  passwordSetupRequired: boolean;
}
interface LocalMapping {
  name: string;
  protocol: string;
  listenPort: number;
  targetServerId: string;
  targetServer: string;
  targetHost: string;
  targetPort: number;
  state: string;
  enabled: boolean;
}
interface LocalStatus {
  ok: boolean;
  service: string;
  port: number;
  configured: boolean;
  connected: boolean;
  systemCredentialsAvailable: boolean;
  serverId?: string;
  workerUrl?: string;
  credentialFile?: string;
  portMappings?: LocalMapping[];
}
interface RemotePlugin {
  id: string;
  name: string;
  version: string;
  state: string;
  capabilities: {
    http: boolean;
    websocket: boolean;
    sse: boolean;
    fileStream: boolean;
  };
  domain?: string;
}
interface RemotePortMapping {
  name: string;
  protocol: string;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  state: string;
}
interface MappingTarget {
  id: string;
  name: string;
  status: string;
  plugins: RemotePlugin[];
  portMappings: RemotePortMapping[];
  pluginDomains?: Record<string, string>;
}
interface LocalPlugin {
  id: string;
  name: string;
  version: string;
  abiVersion: string;
  library: string;
  healthPath: string;
  permissions: string[];
  state: PluginState;
  capabilities: {
    http: boolean;
    websocket: boolean;
    sse: boolean;
    fileStream: boolean;
  };
}
interface Diagnostics extends LocalStatus {
  pluginCount: number;
  loadedPluginCount: number;
  enabledPluginCount: number;
  failedPluginCount: number;
}
interface LocalLog {
  timestamp: string;
  level: number;
  message: string;
}
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = (await response.json().catch(() => null)) as {
    error?: string;
    code?: string;
  } | null;
  if (!response.ok)
    throw new RequestError(data?.error ?? "", response.status, data?.code);
  return data as T;
}
const errorCodeKeys: Record<string, string> = {
  password_too_short: "errors.passwordTooShort",
  password_mismatch: "errors.passwordMismatch",
  password_setup_failed: "errors.passwordSetupFailed",
  registration_failed: "errors.bindFailed",
  plugin_action_failed: "errors.pluginActionFailed",
  health_check_failed: "errors.healthCheckFailed",
  credential_action_failed: "errors.credentialActionFailed",
};
const httpErrorKey = (status: number) =>
  status === 401
    ? "errors.http.unauthorized"
    : status === 403
      ? "errors.http.forbidden"
      : status === 404
        ? "errors.http.notFound"
        : status === 409
          ? "errors.http.conflict"
          : status === 429
            ? "errors.http.rateLimited"
            : status >= 500
              ? "errors.http.serverError"
              : "errors.http.failed";
function errorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof RequestError) {
    const key = error.code
      ? (errorCodeKeys[error.code] ?? `errors.code.${error.code}`)
      : undefined;
    if (key && i18n.exists(key)) {
      const translated = i18n.t(key);
      return error.code === "registration_tls_failed" && error.message
        ? `${translated} (${error.message})`
        : translated;
    }
    if (/[^\x00-\x7F]/.test(error.message)) return error.message;
    return i18n.t(httpErrorKey(error.status), { status: error.status });
  }
  if (error instanceof Error && i18n.exists(error.message))
    return i18n.t(error.message);
  return i18n.t(fallbackKey);
}
const emptySetupForm = {
  workerUrl: "",
  serverName: "",
  registrationCode: "",
  localUiPassword: "",
  localUiPasswordConfirmation: "",
  credentialPassword: "",
  credentialFile: "",
  useSystemCredentials: false,
};
const emptyMapping = {
  name: "",
  protocol: "tcp",
  listenPort: "",
  targetServerId: "",
  targetHost: "127.0.0.1",
  targetPort: "",
  enabled: true,
};

function App() {
  const { t } = useTranslation();
  const [active, setActive] = useState("overview");
  const [isMobileNav, setIsMobileNav] = useState(() => matchMedia("(max-width: 991px)").matches);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("plugmesh-local-theme");
    return saved === "light" || saved === "system" ? saved : "dark";
  });
  const [systemLight, setSystemLight] = useState(
    () => matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [session, setSession] = useState<LocalSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [plugins, setPlugins] = useState<LocalPlugin[]>([]);
  const [mappings, setMappings] = useState<LocalMapping[]>([]);
  const [targets, setTargets] = useState<MappingTarget[]>([]);
  const [logs, setLogs] = useState<LocalLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null);
  const [busyMapping, setBusyMapping] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [setupForm, setSetupForm] = useState(emptySetupForm);
  const [migrationForm, setMigrationForm] = useState({
    password: "",
    passwordConfirmation: "",
    credentialPassword: "",
  });
  const [credentialPassword, setCredentialPassword] = useState("");
  const [authStates, setAuthStates] = useState<
    Record<string, "authorized" | "needs-auth" | "failed">
  >({});
  const [verificationTarget, setVerificationTarget] =
    useState<MappingTarget | null>(null);
  const [targetPassword, setTargetPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [editing, setEditing] = useState("");
  const [mappingForm, setMappingForm] = useState(emptyMapping);
  const [mappingEditor] = Form.useForm();
  const targetFlight = useRef(false);
  const effectiveTheme =
    theme === "system" ? (systemLight ? "light" : "dark") : theme;
  const cycleTheme = () =>
    setTheme(
      theme === "dark" ? "light" : theme === "light" ? "system" : "dark",
    );
  const themeIcon =
    theme === "light" ? (
      <Sun size={15} />
    ) : theme === "system" ? (
      <CircleHelp size={15} />
    ) : (
      <Moon size={15} />
    );
  const loadSession = useCallback(async () => {
    try {
      const next = await request<LocalSession>("/api/session");
      setSession(next);
      setSessionError(null);
      return next;
    } catch (e) {
      setSessionError(errorMessage(e, "errors.localServerUnavailable"));
      return null;
    } finally {
      setSessionLoading(false);
    }
  }, []);
  const refresh = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const [s, d, p, l] = await Promise.all([
          request<LocalStatus>("/api/status"),
          request<Diagnostics>("/api/diagnostics"),
          request<{ plugins: LocalPlugin[] }>("/api/plugins"),
          request<{ logs: LocalLog[] }>("/api/logs"),
        ]);
        setStatus(s);
        setDiagnostics(d);
        setPlugins(p.plugins ?? []);
        setMappings(s.portMappings ?? []);
        setLogs(l.logs ?? []);
        setLastUpdated(new Date());
        setError(null);
      } catch (e) {
        if (e instanceof RequestError && e.status === 401) void loadSession();
        else setError(errorMessage(e, "errors.localServerUnavailable"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadSession],
  );
  const refreshTargets = useCallback(async () => {
    if (targetFlight.current) return;
    targetFlight.current = true;
    try {
      const result = await request<{ targets: MappingTarget[] }>(
        "/api/mappings/targets",
      );
      const next = (result.targets ?? []).map((x) => ({
        ...x,
        plugins: (x.plugins ?? []).map((p) => ({
          ...p,
          domain: x.pluginDomains?.[p.id],
        })),
        portMappings: x.portMappings ?? [],
      }));
      setTargets(next);
      setAuthStates((current) =>
        Object.fromEntries(
          next
            .filter((x) => x.status === "online")
            .map((x) => [x.id, current[x.id] ?? "needs-auth"]),
        ),
      );
      if (
        !mappingForm.targetServerId &&
        next.some((x) => x.status === "online")
      )
        setMappingForm((x) => ({
          ...x,
          targetServerId: next.find((y) => y.status === "online")!.id,
        }));
    } catch (e) {
      setMessage({
        kind: "error",
        text: errorMessage(e, "mappings.targetsFailed"),
      });
    } finally {
      targetFlight.current = false;
    }
  }, [mappingForm.targetServerId]);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    if (!session || session.configured || session.authenticated) return;
    void request<LocalStatus>("/api/status")
      .then((next) => {
        setStatus(next);
        setSetupForm((x) => ({
          ...x,
          credentialFile: x.credentialFile || next.credentialFile || "",
        }));
      })
      .catch((e) =>
        setSessionError(errorMessage(e, "errors.setupStatusFailed")),
      );
  }, [session]);
  useEffect(() => {
    if (!session?.authenticated) return;
    void refresh();
    void refreshTargets();
    const timer = window.setInterval(() => void refresh(), 5000);
    const targetTimer = window.setInterval(() => void refreshTargets(), 15000);
    return () => {
      clearInterval(timer);
      clearInterval(targetTimer);
    };
  }, [session?.authenticated, refresh, refreshTargets]);
  useEffect(() => localStorage.setItem("plugmesh-local-theme", theme), [theme]);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: light)");
    const fn = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [message]);
  const submitLogin = async () => {
    setAccessBusy(true);
    try {
      await request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });
      setLoginPassword("");
      await loadSession();
    } catch (e) {
      setSessionError(errorMessage(e, "errors.loginFailed"));
    } finally {
      setAccessBusy(false);
    }
  };
  const submitMigration = async () => {
    if (
      migrationForm.password.length < 8 ||
      migrationForm.password !== migrationForm.passwordConfirmation
    ) {
      setSessionError(
        t(
          migrationForm.password.length < 8
            ? "errors.passwordTooShort"
            : "errors.passwordMismatch",
        ),
      );
      return;
    }
    setAccessBusy(true);
    try {
      await request("/api/session/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(migrationForm),
      });
      await loadSession();
    } catch (e) {
      setSessionError(errorMessage(e, "errors.passwordSetupFailed"));
    } finally {
      setAccessBusy(false);
    }
  };
  const submitSetup = async () => {
    if (
      setupForm.localUiPassword.length < 8 ||
      setupForm.localUiPassword !== setupForm.localUiPasswordConfirmation
    ) {
      setSessionError(
        t(
          setupForm.localUiPassword.length < 8
            ? "errors.passwordTooShort"
            : "errors.passwordMismatch",
        ),
      );
      return;
    }
    setAccessBusy(true);
    try {
      const { useSystemCredentials: _, ...withoutToggle } = setupForm;
      await request("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          status?.systemCredentialsAvailable ? setupForm : withoutToggle,
        ),
      });
      setMessage({ kind: "success", text: t("setup.success") });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const next = await loadSession();
        if (next) break;
      }
    } catch (e) {
      setSessionError(errorMessage(e, "errors.bindFailed"));
    } finally {
      setAccessBusy(false);
    }
  };
  const logout = async () => {
    await request("/api/session", { method: "DELETE" }).catch(() => null);
    setSession((x) => (x ? { ...x, authenticated: false } : x));
  };
  const pluginAction = async (plugin: LocalPlugin, action: string) => {
    setBusyPlugin(plugin.id);
    try {
      const result = await request<{ state: string }>(
        `/api/plugins/${encodeURIComponent(plugin.id)}/${action}`,
        { method: "POST" },
      );
      setMessage({
        kind: "success",
        text: t("plugins.stateChanged", {
          name: plugin.name,
          state: t(`state.${result.state}`, { defaultValue: result.state }),
        }),
      });
      await refresh();
    } catch (e) {
      setMessage({
        kind: "error",
        text: errorMessage(e, "errors.pluginActionFailed"),
      });
    } finally {
      setBusyPlugin(null);
    }
  };
  const health = async (plugin: LocalPlugin) => {
    setBusyPlugin(plugin.id);
    try {
      const result = await request<{ status: number }>(
        `/api/plugins/${encodeURIComponent(plugin.id)}/health`,
      );
      setMessage({
        kind: "success",
        text: t("plugins.healthPassed", {
          name: plugin.name,
          status: result.status,
        }),
      });
    } catch (e) {
      setMessage({
        kind: "error",
        text: errorMessage(e, "errors.healthCheckFailed"),
      });
    } finally {
      setBusyPlugin(null);
    }
  };
  const authorize = async () => {
    if (!verificationTarget || !targetPassword) return;
    setAuthBusy(true);
    try {
      await request(
        `/api/mappings/targets/${encodeURIComponent(verificationTarget.id)}/authorize`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetPassword }),
        },
      );
      setAuthStates((x) => ({ ...x, [verificationTarget.id]: "authorized" }));
      setMessage({
        kind: "success",
        text: t("mappings.targetAuthorized", { name: verificationTarget.name }),
      });
      setVerificationTarget(null);
    } catch (e) {
      setAuthStates((x) => ({ ...x, [verificationTarget.id]: "failed" }));
      setMessage({
        kind: "error",
        text: errorMessage(e, "mappings.targetAuthorizeFailed"),
      });
    } finally {
      setTargetPassword("");
      setAuthBusy(false);
    }
  };
  const saveMapping = async (values: typeof mappingForm) => {
    setBusyMapping(true);
    try {
      const endpoint = editing
        ? `/api/mappings/${encodeURIComponent(editing)}`
        : "/api/mappings";
      await request(endpoint, {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...values,
          targetPassword: "",
          listenPort: Number(values.listenPort),
          targetPort: Number(values.targetPort),
        }),
      });
      setEditing("");
      setMappingForm(emptyMapping);
      mappingEditor.resetFields();
      await refresh(true);
      setMessage({ kind: "success", text: t("mappings.saved") });
    } catch (e) {
      setMessage({
        kind: "error",
        text: errorMessage(e, "mappings.saveFailed"),
      });
    } finally {
      setBusyMapping(false);
    }
  };
  const mappingAction = async (
    mapping: LocalMapping,
    action: "toggle" | "delete",
  ) => {
    setBusyMapping(true);
    try {
      if (action === "delete")
        await request(`/api/mappings/${encodeURIComponent(mapping.name)}`, {
          method: "DELETE",
        });
      else
        await request(`/api/mappings/${encodeURIComponent(mapping.name)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: mapping.name,
            protocol: mapping.protocol,
            listenPort: mapping.listenPort,
            targetServerId: mapping.targetServerId,
            targetHost: mapping.targetHost,
            targetPort: mapping.targetPort,
            enabled: !mapping.enabled,
          }),
        });
      await refresh(true);
      if (action === "delete")
        setMessage({ kind: "success", text: t("mappings.deleted") });
    } catch (e) {
      setMessage({
        kind: "error",
        text: errorMessage(
          e,
          action === "delete" ? "mappings.deleteFailed" : "mappings.saveFailed",
        ),
      });
    } finally {
      setBusyMapping(false);
    }
  };
  const credentialAction = async (action: "rotate" | "revoke", confirmed = false) => {
    try {
    if (action === "revoke" && !confirmed) {
      Modal.confirm({
        title: t("binding.revoke"),
        content: t("binding.revokeConfirm"),
        okText: t("binding.revoke"),
        cancelText: t("common.cancel"),
        okButtonProps: { danger: true },
        onOk: () => credentialAction("revoke", true),
      });
      return;
    }
      await request(`/api/credentials/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialPassword }),
      });
      setCredentialPassword("");
      setMessage({
        kind: "success",
        text: t(
          action === "rotate" ? "binding.rotateDone" : "binding.revokeDone",
        ),
      });
      await refresh(true);
    } catch (e) {
      setMessage({
        kind: "error",
        text: errorMessage(e, "errors.credentialActionFailed"),
      });
    }
  };
  if (sessionLoading || !session)
    return (
      <AccessShell
        theme={effectiveTheme}
        themeIcon={themeIcon}
        onTheme={cycleTheme}
        error={sessionError}
      >
        <Spin tip={t("access.loading")} />
      </AccessShell>
    );
  if (!session.configured)
    return (
      <AccessShell
        theme={effectiveTheme}
        themeIcon={themeIcon}
        onTheme={cycleTheme}
        error={sessionError}
      >
        <SetupForm
          value={setupForm}
          setValue={setSetupForm}
          status={status}
          busy={accessBusy}
          onSubmit={() => void submitSetup()}
        />
      </AccessShell>
    );
  if (session.passwordSetupRequired)
    return (
      <AccessShell
        theme={effectiveTheme}
        themeIcon={themeIcon}
        onTheme={cycleTheme}
        error={sessionError}
      >
        <Form layout="vertical" onFinish={() => void submitMigration()}>
          <Typography.Title level={3}>{t("migration.title")}</Typography.Title>
          <Form.Item
            label={t("setup.localUiPassword")}
            name="password"
            rules={[{ required: true }]}
          >
            <Input.Password
              value={migrationForm.password}
              onChange={(e) =>
                setMigrationForm((x) => ({ ...x, password: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label={t("setup.confirmPassword")}>
            <Input.Password
              value={migrationForm.passwordConfirmation}
              onChange={(e) =>
                setMigrationForm((x) => ({
                  ...x,
                  passwordConfirmation: e.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label={t("setup.credentialPassword")}>
            <Input.Password
              value={migrationForm.credentialPassword}
              onChange={(e) =>
                setMigrationForm((x) => ({
                  ...x,
                  credentialPassword: e.target.value,
                }))
              }
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={accessBusy}>
            {t("migration.submit")}
          </Button>
        </Form>
      </AccessShell>
    );
  if (!session.authenticated)
    return (
      <AccessShell
        theme={effectiveTheme}
        themeIcon={themeIcon}
        onTheme={cycleTheme}
        error={sessionError}
      >
        <Form layout="vertical" onFinish={() => void submitLogin()}>
          <Typography.Title level={3}>{t("login.title")}</Typography.Title>
          <Form.Item
            label={t("setup.localUiPassword")}
            name="password"
            rules={[{ required: true }]}
          >
            <Input.Password
              autoFocus
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={accessBusy}
            icon={<LogIn size={15} />}
          >
            {t("login.submit")}
          </Button>
        </Form>
      </AccessShell>
    );
  const menuItems = [
    { key: "overview", icon: <Activity size={16} />, label: t("nav.overview") },
    { key: "plugins", icon: <FileCode2 size={16} />, label: t("nav.plugins") },
    { key: "mappings", icon: <Network size={16} />, label: t("nav.mappings") },
    { key: "setup", icon: <Settings2 size={16} />, label: t("nav.settings") },
    { key: "logs", icon: <Terminal size={16} />, label: t("nav.logs") },
  ];
  const onlineTargets = targets.filter((x) => x.status === "online");
  const enabled =
    diagnostics?.enabledPluginCount ??
    plugins.filter((x) => x.state === "enabled").length;
  return (
    <ConfigProvider
      theme={{
        algorithm:
          effectiveTheme === "dark"
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
        token: { borderRadius: 6, colorPrimary: "#1677ff" },
      }}
    >
      <Layout className={`native-layout theme-${effectiveTheme}`}>
        <Layout.Sider
          breakpoint="lg"
          collapsedWidth="0"
          collapsed={isMobileNav && !mobileNavOpen}
          trigger={null}
          onBreakpoint={(broken) => { setIsMobileNav(broken); if (!broken) setMobileNavOpen(false); }}
          className="native-sider"
        >
          <div className="native-brand">
            <Network size={18} />
            <Typography.Title level={4}>PLUGMESH</Typography.Title>
          </div>
          <Menu
            theme={effectiveTheme}
            mode="inline"
            selectedKeys={[active]}
            items={menuItems}
            onClick={({ key }) => { setActive(key); setMobileNavOpen(false); }}
          />
          <div className="sider-footer">
            <HardDrive size={14} />
            127.0.0.1:{status?.port ?? "----"}
          </div>
        </Layout.Sider>
        <Layout>
          <Layout.Header className="native-header">
            <Space>
              <Typography.Text type="secondary">
                {t("shell.overline")}
              </Typography.Text>
              {isMobileNav && (
                <Button
                  aria-label={t("nav.toggle")}
                  aria-expanded={mobileNavOpen}
                  icon={<MenuIcon size={16} />}
                  onClick={() => setMobileNavOpen((open) => !open)}
                />
              )}
              <Typography.Title level={3}>{t("shell.title")}</Typography.Title>
            </Space>
            <Space>
              <Button
                aria-label={t("shell.refresh")}
                icon={<RefreshCw size={16} />}
                loading={refreshing}
                onClick={() => void refresh(true)}
              />
              <Button
                aria-label={t("shell.theme")}
                icon={themeIcon}
                onClick={cycleTheme}
              />
              <LanguageButton />
              <Button
                aria-label={t("shell.logout")}
                icon={<LogOut size={16} />}
                onClick={() => void logout()}
              />
            </Space>
          </Layout.Header>
          <Layout.Content className="native-content">
            {message && (
              <Alert
                closable
                showIcon
                type={message.kind === "success" ? "success" : "error"}
                message={message.text}
                onClose={() => setMessage(null)}
              />
            )}
            {error && (
              <Alert
                showIcon
                type="error"
                message={t("shell.readError")}
                description={error}
                action={
                  <Button onClick={() => void refresh(true)}>
                    {t("common.retry")}
                  </Button>
                }
              />
            )}
            {active === "overview" && (
              <Overview
                status={status}
                diagnostics={diagnostics}
                plugins={plugins}
                enabled={enabled}
                lastUpdated={lastUpdated}
                t={t}
              />
            )}
            {active === "plugins" && (
              <PluginsPage
                plugins={plugins}
                loading={loading}
                busy={busyPlugin}
                onAction={(p: LocalPlugin, a: string) =>
                  void pluginAction(p, a)
                }
                onHealth={(p: LocalPlugin) => void health(p)}
                t={t}
              />
            )}
            {active === "mappings" && (
              <MappingsPage
                targets={onlineTargets}
                allTargets={targets}
                authStates={authStates}
                mappings={mappings}
                mappingForm={mappingForm}
                setMappingForm={setMappingForm}
                editing={editing}
                setEditing={setEditing}
                form={mappingEditor}
                busy={busyMapping}
                authBusy={authBusy}
                refreshTargets={() => void refreshTargets()}
                onVerify={(target: MappingTarget) => {
                  setTargetPassword("");
                  setVerificationTarget(target);
                }}
                onSave={saveMapping}
                onMappingAction={mappingAction}
                t={t}
              />
            )}
            {active === "setup" && (
              <SetupPage
                status={status}
                credentialPassword={credentialPassword}
                setCredentialPassword={setCredentialPassword}
                onAction={credentialAction}
                t={t}
              />
            )}
            {active === "logs" && <LogsPage logs={logs} t={t} />}
          </Layout.Content>
        </Layout>
        <Modal
          title={t("mappings.targetPassword")}
          open={Boolean(verificationTarget)}
          onCancel={() => {
            setVerificationTarget(null);
            setTargetPassword("");
          }}
          onOk={() => void authorize()}
          okText={t("mappings.authorizeTarget")}
          confirmLoading={authBusy}
          okButtonProps={{ disabled: !targetPassword }}
          destroyOnClose
        >
          <Typography.Paragraph>
            {verificationTarget?.name}
          </Typography.Paragraph>
          <Input.Password
            aria-label={t("mappings.targetPassword")}
            value={targetPassword}
            onChange={(e) => setTargetPassword(e.target.value)}
            onPressEnter={() => void authorize()}
          />
        </Modal>
      </Layout>
    </ConfigProvider>
  );
}

function AccessShell({
  theme,
  themeIcon,
  onTheme,
  error,
  children,
}: {
  theme: "dark" | "light";
  themeIcon: React.ReactNode;
  onTheme: () => void;
  error: string | null;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={`access-shell theme-${theme}`}>
      <header className="access-header">
        <Typography.Title level={3}>PLUGMESH</Typography.Title>
        <Space>
          <LanguageButton />
          <Button
            aria-label={t("shell.theme")}
            icon={themeIcon}
            onClick={onTheme}
          />
        </Space>
      </header>
      <main className="access-main">
        <Card
          title={
            <Typography.Title level={2}>{t("access.title")}</Typography.Title>
          }
          className="access-card"
        >
          {error && (
            <Alert role="alert" type="error" showIcon message={error} />
          )}
          {children}
        </Card>
      </main>
    </div>
  );
}
function SetupForm({
  value,
  setValue,
  status,
  busy,
  onSubmit,
}: {
  value: typeof emptySetupForm;
  setValue: React.Dispatch<React.SetStateAction<typeof emptySetupForm>>;
  status: LocalStatus | null;
  busy: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const f = (key: keyof typeof emptySetupForm) => ({
    value: value[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setValue((x) => ({ ...x, [key]: e.target.value })),
  });
  return (
    <Form layout="vertical" onFinish={onSubmit}>
      <Typography.Title level={3}>{t("setup.title")}</Typography.Title>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item name="workerUrl" label={t("setup.workerUrl")} required>
            <Input {...f("workerUrl")} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="serverName" label={t("setup.serverName")} required>
            <Input {...f("serverName")} />
          </Form.Item>
        </Col>
        <Col xs={24}>
          <Form.Item
            name="registrationCode"
            label={t("setup.registrationCode")}
            required
          >
            <Input {...f("registrationCode")} />
          </Form.Item>
        </Col>
        {status?.systemCredentialsAvailable && (
          <Col xs={24}>
            <Checkbox
              checked={value.useSystemCredentials}
              onChange={(e) =>
                setValue((x) => ({
                  ...x,
                  useSystemCredentials: e.target.checked,
                }))
              }
            >
              {t("setup.useSystemCredentials")}
            </Checkbox>
          </Col>
        )}
        {!value.useSystemCredentials && (
          <>
            <Col xs={24} md={12}>
              <Form.Item
                name="credentialFile"
                label={t("setup.credentialFile")}
                required
              >
                <Input {...f("credentialFile")} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="credentialPassword"
                label={t("setup.credentialPassword")}
                required
              >
                <Input.Password {...f("credentialPassword")} />
              </Form.Item>
            </Col>
          </>
        )}
        <Col xs={24} md={12}>
          <Form.Item
            name="localUiPassword"
            label={t("setup.localUiPassword")}
            required
          >
            <Input.Password {...f("localUiPassword")} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="localUiPasswordConfirmation"
            label={t("setup.confirmPassword")}
            required
          >
            <Input.Password {...f("localUiPasswordConfirmation")} />
          </Form.Item>
        </Col>
      </Row>
      <Button
        type="primary"
        htmlType="submit"
        loading={busy}
        icon={<ShieldCheck size={15} />}
      >
        {t("setup.submit")}
      </Button>
    </Form>
  );
}
function Overview({
  status,
  diagnostics,
  plugins,
  enabled,
  lastUpdated,
  t,
}: any) {
  return (
    <>
      <Typography.Title level={2}>{t("nav.overview")}</Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card
            title={
              status?.connected
                ? t("overview.connectedTitle")
                : t("overview.offlineTitle")
            }
          >
            <Alert
              type={status?.connected ? "success" : "warning"}
              showIcon
              message={
                status?.connected ? t("overview.online") : t("overview.offline")
              }
              description={
                status?.connected
                  ? t("overview.connectedBody")
                  : t("overview.offlineBody")
              }
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Descriptions column={1}>
              <Descriptions.Item label={t("connector.label")}>
                {status?.connected
                  ? t("connector.online")
                  : t("connector.offline")}
              </Descriptions.Item>
              <Descriptions.Item label="Server ID">
                {status?.serverId ?? t("common.serverIdMissing")}
              </Descriptions.Item>
              <Descriptions.Item
                label={t("common.updatedAt", {
                  time: lastUpdated?.toLocaleTimeString() ?? "—",
                })}
              >
                {status?.port ?? "—"}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        {[
          [t("metrics.plugins"), diagnostics?.pluginCount ?? plugins.length],
          [t("metrics.enabled"), enabled],
          [t("metrics.failed"), diagnostics?.failedPluginCount ?? 0],
          [t("metrics.port"), status?.port ?? "—"],
        ].map(([label, value]) => (
          <Col xs={12} md={6} key={String(label)}>
            <Card>
              <Statistic title={label} value={value as any} />
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
function PluginsPage({ plugins, loading, busy, onAction, onHealth, t }: any) {
  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      render: (_: string, p: LocalPlugin) => (
        <Space direction="vertical">
          <Typography.Text strong>{p.name}</Typography.Text>
          <Typography.Text type="secondary">
            {p.id} · v{p.version} · ABI {p.abiVersion}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "State",
      dataIndex: "state",
      render: (s: string) => (
        <Tag
          color={s === "enabled" ? "green" : s === "failed" ? "red" : "gold"}
        >
          {t(`state.${s}`, { defaultValue: s })}
        </Tag>
      ),
    },
    { title: t("plugins.library"), dataIndex: "library" },
    {
      title: "Actions",
      render: (_: unknown, p: LocalPlugin) => (
        <PluginActions
          plugin={p}
          busy={busy === p.id}
          onAction={onAction}
          onHealth={onHealth}
          t={t}
        />
      ),
    },
  ];
  return (
    <Card
      title={
        <Typography.Title level={2}>{t("plugins.title")}</Typography.Title>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        locale={{ emptyText: <Empty description={t("plugins.emptyTitle")} /> }}
        dataSource={plugins}
        columns={columns}
        scroll={{ x: 700 }}
      />
    </Card>
  );
}
function PluginActions({ plugin, busy, onAction, onHealth, t }: any) {
  if (busy) return <Spin size="small" />;
  return (
    <Space wrap>
      {plugin.state === "enabled" && (
        <Button
          aria-label={t("plugins.health")}
          size="small"
          onClick={() => onHealth(plugin)}
        >
          {t("plugins.health")}
        </Button>
      )}
      <Button
        aria-label={
          plugin.state === "discovered" || plugin.state === "unloaded"
            ? t("plugins.load")
            : t("plugins.reload")
        }
        size="small"
        onClick={() =>
          onAction(
            plugin,
            plugin.state === "discovered" || plugin.state === "unloaded"
              ? "load"
              : "reload",
          )
        }
      >
        {plugin.state === "discovered" || plugin.state === "unloaded"
          ? t("plugins.load")
          : t("plugins.reload")}
      </Button>
      {(plugin.state === "loaded" || plugin.state === "disabled") && (
        <Button
          aria-label={t("plugins.enable")}
          size="small"
          type="primary"
          onClick={() => onAction(plugin, "enable")}
        >
          {t("plugins.enable")}
        </Button>
      )}
      {plugin.state === "enabled" && (
        <Button
          aria-label={t("plugins.disable")}
          size="small"
          onClick={() => onAction(plugin, "disable")}
        >
          {t("plugins.disable")}
        </Button>
      )}
      {plugin.state !== "discovered" && plugin.state !== "unloaded" && (
        <Button
          aria-label={t("plugins.unload")}
          size="small"
          danger
          onClick={() => onAction(plugin, "unload")}
        >
          {t("plugins.unload")}
        </Button>
      )}
    </Space>
  );
}
function MappingsPage({
  targets,
  allTargets,
  authStates,
  mappings,
  mappingForm,
  setMappingForm,
  editing,
  setEditing,
  form,
  busy,
  authBusy,
  refreshTargets,
  onVerify,
  onSave,
  onMappingAction,
  t,
}: any) {
  const targetOptions = targets.map((x: MappingTarget) => ({
    label: x.name,
    value: x.id,
  }));
  const columns = [
    { title: t("mappings.name"), dataIndex: "name" },
    {
      title: "Endpoint",
      render: (_: unknown, m: LocalMapping) =>
        `${m.protocol.toUpperCase()} · 127.0.0.1:${m.listenPort} → ${m.targetHost}:${m.targetPort}`,
    },
    { title: t("mappings.targetServer"), dataIndex: "targetServer" },
    {
      title: "State",
      render: (_: unknown, m: LocalMapping) => (
        <Tag color={m.state === "listening" ? "green" : "gold"}>
          {t(
            m.state === "listening" ? "mappings.listening" : "mappings.stopped",
          )}
        </Tag>
      ),
    },
    {
      title: "Actions",
      render: (_: unknown, m: LocalMapping) => (
        <Space>
          <Button
            aria-label={t(m.enabled ? "mappings.disable" : "mappings.enable")}
            icon={<Power size={14} />}
            onClick={() => onMappingAction(m, "toggle")}
          />
          <Button
            aria-label={t("mappings.edit")}
            icon={<Pencil size={14} />}
            onClick={() => {
              setEditing(m.name);
              const next = {
                name: m.name,
                protocol: m.protocol,
                listenPort: String(m.listenPort),
                targetServerId: m.targetServerId,
                targetHost: m.targetHost,
                targetPort: String(m.targetPort),
                enabled: m.enabled,
              };
              setMappingForm(next);
              form.setFieldsValue(next);
            }}
          />
          <Popconfirm
            title={t("mappings.delete")}
            onConfirm={() => onMappingAction(m, "delete")}
          >
            <Button
              danger
              aria-label={t("mappings.delete")}
              icon={<Trash2 size={14} />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];
  return (
    <Space direction="vertical" size="large" className="screen-stack">
      <Card
        title={
          <Space>
            <Typography.Title level={2}>{t("mappings.title")}</Typography.Title>
            <Button icon={<RefreshCw size={14} />} onClick={refreshTargets}>
              {t("mappings.refreshTargets")}
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={allTargets}
          pagination={false}
          scroll={{ x: 600 }}
          columns={[
            {
              title: t("mappings.targetServer"),
              render: (_: unknown, x: MappingTarget) => (
                <Space direction="vertical">
                  <Typography.Text>{x.name}</Typography.Text>
                  <Typography.Text type="secondary">{x.id}</Typography.Text>
                </Space>
              ),
            },
            {
              title: "Status",
              render: (_: unknown, x: MappingTarget) => (
                <Tag color={x.status === "online" ? "green" : "default"}>
                  {x.status}
                </Tag>
              ),
            },
            {
              title: "Authorization",
              render: (_: unknown, x: MappingTarget) => (
                <Tag
                  color={
                    authStates[x.id] === "authorized"
                      ? "green"
                      : authStates[x.id] === "failed"
                        ? "red"
                        : "gold"
                  }
                >
                  {t(
                    authStates[x.id] === "authorized"
                      ? "mappings.authorized"
                      : authStates[x.id] === "failed"
                        ? "mappings.failed"
                        : "mappings.needsAuth",
                  )}
                </Tag>
              ),
            },
            {
              title: "Action",
              render: (_: unknown, x: MappingTarget) => (
                <Button
                  disabled={x.status !== "online" || authBusy}
                  onClick={() => onVerify(x)}
                  icon={<KeyRound size={14} />}
                >
                  {t("mappings.verifyMenu")}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title={editing ? t("mappings.update") : t("mappings.add")}>
        <Form
          form={form}
          layout="vertical"
          initialValues={mappingForm}
          onFinish={onSave}
        >
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="name"
                label={t("mappings.name")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="protocol" label={t("mappings.protocol")}>
                <Select
                  options={[
                    { value: "tcp", label: "TCP" },
                    { value: "http", label: "HTTP" },
                    { value: "websocket", label: "WebSocket" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item
                name="listenPort"
                label={t("mappings.listenPort")}
                rules={[{ required: true }]}
              >
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="targetServerId"
                label={t("mappings.targetServer")}
                rules={[{ required: true }]}
              >
                <Select
                  aria-label={t("mappings.targetServer")}
                  options={targetOptions}
                  placeholder={t("mappings.selectTarget")}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="targetHost"
                label={t("mappings.targetHost")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="targetPort"
                label={t("mappings.targetPort")}
                rules={[{ required: true }]}
              >
                <Input type="number" />
              </Form.Item>
            </Col>
          </Row>
          <Space>
            <Button type="primary" htmlType="submit" loading={busy}>
              {editing ? t("mappings.update") : t("mappings.add")}
            </Button>
            {editing && (
              <Button
                onClick={() => {
                  setEditing("");
                  setMappingForm(emptyMapping);
                  form.resetFields();
                }}
              >
                {t("common.cancel")}
              </Button>
            )}
          </Space>
        </Form>
      </Card>
      <Card title={t("mappings.title")}>
        <Table
          rowKey="name"
          dataSource={mappings}
          locale={{
            emptyText: <Empty description={t("mappings.emptyTitle")} />,
          }}
          columns={columns}
          scroll={{ x: 700 }}
        />
      </Card>
    </Space>
  );
}
function SetupPage({
  status,
  credentialPassword,
  setCredentialPassword,
  onAction,
  t,
}: any) {
  return (
    <Card
      title={
        <Typography.Title level={2}>{t("binding.title")}</Typography.Title>
      }
    >
      <Descriptions bordered column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Server ID">
          {status?.serverId ?? "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("binding.configured")}>
          <Tag color="green">{t("binding.configured")}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Worker">
          {status?.workerUrl ?? "—"}
        </Descriptions.Item>
        <Descriptions.Item
          label={t("binding.storeFile", {
            path: status?.credentialFile ?? t("binding.storeSystem"),
          })}
        >
          {status?.credentialFile ?? t("binding.storeSystem")}
        </Descriptions.Item>
      </Descriptions>
      <Form layout="vertical" className="setup-action-form">
        <Form.Item label={t("binding.credentialPassword")}>
          <Input.Password
            value={credentialPassword}
            onChange={(e) => setCredentialPassword(e.target.value)}
          />
        </Form.Item>
        <Space>
          <Button onClick={() => onAction("rotate")}>
            {t("binding.rotate")}
          </Button>
          <Button danger onClick={() => onAction("revoke")}>
            {t("binding.revoke")}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
function LogsPage({ logs, t }: any) {
  return (
    <Card
      title={<Typography.Title level={2}>{t("logs.title")}</Typography.Title>}
    >
      <Table
        rowKey={(x: LocalLog, i) => `${x.timestamp}-${i}`}
        dataSource={logs.slice().reverse()}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: "Level",
            render: (_: unknown, x: LocalLog) => (
              <Tag
                color={x.level >= 3 ? "red" : x.level === 2 ? "gold" : "green"}
              >
                {x.level >= 3 ? "ERR" : x.level === 2 ? "WARN" : "INFO"}
              </Tag>
            ),
          },
          { title: "Time", dataIndex: "timestamp" },
          { title: "Message", dataIndex: "message" },
        ]}
        locale={{ emptyText: <Empty description={t("logs.emptyTitle")} /> }}
      />
    </Card>
  );
}
function LanguageButton() {
  const { t, i18n: translate } = useTranslation();
  const next = translate.resolvedLanguage === "en" ? "zh-CN" : "en";
  return (
    <Button
      aria-label={t("language.switch")}
      icon={<Languages size={16} />}
      onClick={() => {
        storeLanguage(next);
        void translate.changeLanguage(next);
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: { borderRadius: 6, colorPrimary: "#1677ff" },
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>,
);
export default App;
