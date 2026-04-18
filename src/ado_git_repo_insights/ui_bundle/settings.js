"use strict";
var PRInsightsSettings = (() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // ../ui/types.ts
  function isErrorWithMessage(error) {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
  }
  function getErrorMessage(error) {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
  }

  // ../ui/modules/shared/security.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ../ui/modules/shared/render.ts
  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }
  function createElement(tag, attributes, textContent) {
    const el = document.createElement(tag);
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        el.setAttribute(key, value);
      }
    }
    if (textContent !== void 0) {
      el.textContent = textContent;
    }
    return el;
  }
  function renderTrustedHtml(container, trustedHtml) {
    if (!container) return;
    container.innerHTML = trustedHtml;
  }
  function createOption(value, text, selected = false) {
    const option = createElement("option", { value }, text);
    if (selected) {
      option.selected = true;
    }
    return option;
  }

  // ../ui/modules/shared/focus-trap.ts
  var trapStates = /* @__PURE__ */ new WeakMap();
  function restoreFocus(controller) {
    const state = trapStates.get(controller);
    controller.abort();
    if (state && state.returnTarget && !state.returnTarget.isConnected) {
      return;
    }
    state?.returnTarget?.focus();
  }

  // ../ui/modules/drilldown/lifecycle-signals.ts
  var COMPARISON_TOGGLED_EVENT = "drilldown:comparison-toggled";

  // ../ui/modules/shared/detail-panel.ts
  var panelEls = null;
  var panelState = "closed";
  var activeContext = null;
  var focusTrapController = null;
  var openScopedController = null;
  var comparisonActive = false;
  {
    const lifetimeComparisonListener = (evt) => {
      const e2 = evt;
      comparisonActive = e2.detail.enabled;
    };
    window.addEventListener(COMPARISON_TOGGLED_EVENT, lifetimeComparisonListener);
  }
  function isDetailPanelOpen() {
    return panelState === "opening" || panelState === "open";
  }
  function dismissDetailPanel(reason) {
    if (!isDetailPanelOpen()) return;
    panelState = "closing";
    openScopedController?.abort();
    openScopedController = null;
    const trigger = activeContext?.triggerElement ?? null;
    if (focusTrapController) {
      if (trigger && trigger.isConnected) {
        restoreFocus(focusTrapController);
        trigger.focus();
      } else {
        restoreFocus(focusTrapController);
      }
      focusTrapController = null;
    }
    finalizeClose();
    void reason;
  }
  function finalizeClose() {
    if (panelEls) {
      panelEls.root.classList.remove("is-open");
    }
    activeContext = null;
    panelState = "closed";
  }

  // ../node_modules/.pnpm/azure-devops-extension-sdk@4.2.0/node_modules/azure-devops-extension-sdk/esm/SDK.min.js
  var e = parseInt("10000000000", 36);
  var t = Number.MAX_SAFE_INTEGER || 9007199254740991;
  var n = class {
    constructor() {
      __publicField(this, "objects", {});
    }
    register(e2, t2) {
      this.objects[e2] = t2;
    }
    unregister(e2) {
      delete this.objects[e2];
    }
    getInstance(e2, t2) {
      var n2 = this.objects[e2];
      if (n2) return "function" == typeof n2 ? n2(t2) : n2;
    }
  };
  var o = 1;
  var r = class {
    constructor(r2, i2) {
      __publicField(this, "promises", {});
      __publicField(this, "postToWindow");
      __publicField(this, "targetOrigin");
      __publicField(this, "handshakeToken");
      __publicField(this, "registry");
      __publicField(this, "channelId");
      __publicField(this, "nextMessageId", 1);
      __publicField(this, "nextProxyId", 1);
      __publicField(this, "proxyFunctions", {});
      this.postToWindow = r2, this.targetOrigin = i2, this.registry = new n(), this.channelId = o++, this.targetOrigin || (this.handshakeToken = Math.floor(Math.random() * (t - e) + e).toString(36) + Math.floor(Math.random() * (t - e) + e).toString(36));
    }
    getObjectRegistry() {
      return this.registry;
    }
    async invokeRemoteMethod(e2, t2, n2, o2, r2) {
      const i2 = { id: this.nextMessageId++, methodName: e2, instanceId: t2, instanceContext: o2, params: this._customSerializeObject(n2, r2), serializationSettings: r2 };
      this.targetOrigin || (i2.handshakeToken = this.handshakeToken);
      const s2 = new Promise(((e3, t3) => {
        this.promises[i2.id] = { resolve: e3, reject: t3 };
      }));
      return this._sendRpcMessage(i2), s2;
    }
    getRemoteObjectProxy(e2, t2) {
      return this.invokeRemoteMethod("", e2, void 0, t2);
    }
    invokeMethod(e2, t2) {
      if (t2.methodName) {
        var n2 = e2[t2.methodName];
        if ("function" == typeof n2) try {
          var o2 = [];
          t2.params && (o2 = this._customDeserializeObject(t2.params, {}));
          var r2 = n2.apply(e2, o2);
          r2 && r2.then && "function" == typeof r2.then ? r2.then(((e3) => {
            this._success(t2, e3, t2.handshakeToken);
          }), ((e3) => {
            this.error(t2, e3);
          })) : this._success(t2, r2, t2.handshakeToken);
        } catch (e3) {
          this.error(t2, e3);
        }
        else this.error(t2, new Error("RPC method not found: " + t2.methodName));
      } else this._success(t2, e2, t2.handshakeToken);
    }
    getRegisteredObject(e2, t2) {
      if ("__proxyFunctions" === e2) return this.proxyFunctions;
      var n2 = this.registry.getInstance(e2, t2);
      return n2 || (n2 = i.getInstance(e2, t2)), n2;
    }
    onMessage(e2) {
      if (e2.instanceId) {
        const t2 = this.getRegisteredObject(e2.instanceId, e2.instanceContext);
        if (!t2) return false;
        "function" == typeof t2.then ? t2.then(((t3) => {
          this.invokeMethod(t3, e2);
        }), ((t3) => {
          this.error(e2, t3);
        })) : this.invokeMethod(t2, e2);
      } else {
        const t2 = this.promises[e2.id];
        if (!t2) return false;
        e2.error ? t2.reject(this._customDeserializeObject([e2.error], {})[0]) : t2.resolve(this._customDeserializeObject([e2.result], {})[0]), delete this.promises[e2.id];
      }
      return true;
    }
    owns(e2, t2, n2) {
      if (this.postToWindow === e2) {
        if (this.targetOrigin) return !!t2 && ("null" === t2.toLowerCase() || 0 === this.targetOrigin.toLowerCase().indexOf(t2.toLowerCase()));
        if (n2.handshakeToken && n2.handshakeToken === this.handshakeToken) return this.targetOrigin = t2, true;
      }
      return false;
    }
    error(e2, t2) {
      this._sendRpcMessage({ id: e2.id, error: this._customSerializeObject([t2], e2.serializationSettings)[0], handshakeToken: e2.handshakeToken });
    }
    _success(e2, t2, n2) {
      this._sendRpcMessage({ id: e2.id, result: this._customSerializeObject([t2], e2.serializationSettings)[0], handshakeToken: n2 });
    }
    _sendRpcMessage(e2) {
      this.postToWindow.postMessage(JSON.stringify(e2), "*");
    }
    _customSerializeObject(e2, t2, n2, o2 = 1, r2 = 1) {
      if (!e2 || r2 > 100) return;
      if (e2 instanceof Node || e2 instanceof Window || e2 instanceof Event) return;
      var i2;
      let s2;
      s2 = n2 || { newObjects: [], originalObjects: [] }, s2.originalObjects.push(e2);
      var c = (n3, i3, c2) => {
        var a3;
        try {
          a3 = n3[c2];
        } catch (e3) {
        }
        var h3 = typeof a3;
        if ("undefined" !== h3) {
          var d3 = -1;
          if ("object" === h3 && (d3 = s2.originalObjects.indexOf(a3)), d3 >= 0) {
            var u2 = s2.newObjects[d3];
            u2.__circularReferenceId || (u2.__circularReferenceId = o2++), i3[c2] = { __circularReference: u2.__circularReferenceId };
          } else "function" === h3 ? (this.nextProxyId++, i3[c2] = { __proxyFunctionId: this._registerProxyFunction(a3, e2), _channelId: this.channelId }) : "object" === h3 ? a3 && a3 instanceof Date ? i3[c2] = { __proxyDate: a3.getTime() } : i3[c2] = this._customSerializeObject(a3, t2, s2, o2, r2 + 1) : "__proxyFunctionId" !== c2 && (i3[c2] = a3);
        }
      };
      if (e2 instanceof Array) {
        i2 = [], s2.newObjects.push(i2);
        for (var a2 = 0, h2 = e2.length; a2 < h2; a2++) c(e2, i2, a2);
      } else {
        i2 = {}, s2.newObjects.push(i2);
        let n3 = {};
        try {
          n3 = (function(e3) {
            const t3 = {};
            for (; e3 && e3 !== Object.prototype; ) {
              const n4 = Object.getOwnPropertyNames(e3);
              for (const e4 of n4) "constructor" !== e4 && (t3[e4] = true);
              e3 = Object.getPrototypeOf(e3);
            }
            return t3;
          })(e2);
        } catch (e3) {
        }
        for (var d2 in n3) (d2 && "_" !== d2[0] || t2 && t2.includeUnderscoreProperties) && c(e2, i2, d2);
      }
      return s2.originalObjects.pop(), s2.newObjects.pop(), i2;
    }
    _registerProxyFunction(e2, t2) {
      var n2 = this.nextProxyId++;
      return this.proxyFunctions["proxy" + n2] = function() {
        return e2.apply(t2, Array.prototype.slice.call(arguments, 0));
      }, n2;
    }
    _customDeserializeObject(e2, t2) {
      var n2 = this;
      if (!e2) return null;
      var o2 = (e3, o3) => {
        var r3 = e3[o3], i3 = typeof r3;
        "__circularReferenceId" === o3 && "number" === i3 ? (t2[r3] = e3, delete e3[o3]) : "object" === i3 && r3 && (r3.__proxyFunctionId ? e3[o3] = function() {
          return n2.invokeRemoteMethod("proxy" + r3.__proxyFunctionId, "__proxyFunctions", Array.prototype.slice.call(arguments, 0), {}, { includeUnderscoreProperties: true });
        } : r3.__proxyDate ? e3[o3] = new Date(r3.__proxyDate) : r3.__circularReference ? e3[o3] = t2[r3.__circularReference] : this._customDeserializeObject(r3, t2));
      };
      if (e2 instanceof Array) for (var r2 = 0, i2 = e2.length; r2 < i2; r2++) o2(e2, r2);
      else if ("object" == typeof e2) for (var s2 in e2) o2(e2, s2);
      return e2;
    }
  };
  var i = new n();
  var s = new class {
    constructor() {
      __publicField(this, "_channels", []);
      __publicField(this, "_handleMessageReceived", (e2) => {
        let t2;
        if ("string" == typeof e2.data) try {
          t2 = JSON.parse(e2.data);
        } catch (e3) {
        }
        if (t2) {
          let n2, o2 = false;
          for (const r2 of this._channels) r2.owns(e2.source, e2.origin, t2) && (n2 = r2, o2 = r2.onMessage(t2) || o2);
          n2 && !o2 && (window.console && console.error(`No handler found on any channel for message: ${JSON.stringify(t2)}`), t2.instanceId && n2.error(t2, new Error(`The registered object ${t2.instanceId} could not be found.`)));
        }
      });
      window.addEventListener("message", this._handleMessageReceived);
    }
    addChannel(e2, t2) {
      const n2 = new r(e2, t2);
      return this._channels.push(n2), n2;
    }
    removeChannel(e2) {
      this._channels = this._channels.filter(((t2) => t2 !== e2));
    }
  }();
  var a = window;
  var h;
  a._AzureDevOpsSDKVersion && console.error("The AzureDevOps SDK is already loaded. Only one version of this module can be loaded in a given document."), a._AzureDevOpsSDKVersion = 4.2, (function(e2) {
    e2[e2.Unknown = 0] = "Unknown", e2[e2.Deployment = 1] = "Deployment", e2[e2.Enterprise = 2] = "Enterprise", e2[e2.Organization = 4] = "Organization";
  })(h || (h = {}));
  var d = "DevOps.HostControl";
  var u = s.addChannel(window.parent);
  var l;
  var f;
  var g;
  var p;
  var m;
  var y;
  var v;
  var _;
  var b;
  var w;
  var O = new Promise(((e2) => {
    w = e2;
  }));
  function x(e2, t2) {
    const n2 = window;
    let o2;
    "function" == typeof n2.CustomEvent ? o2 = new n2.CustomEvent(e2, t2) : (t2 = t2 || { bubbles: false, cancelable: false }, o2 = document.createEvent("CustomEvent"), o2.initCustomEvent(e2, t2.bubbles, t2.cancelable, t2.detail)), window.dispatchEvent(o2);
  }
  function k(e2) {
    return new Promise(((t2) => {
      const n2 = { ...e2, sdkVersion: 4.2 };
      u.invokeRemoteMethod("initialHandshake", d, [n2]).then(((e3) => {
        if ("pageContext" in e3) {
          const t3 = e3;
          if (g = t3.pageContext, f = g ? g.webContext : void 0, l = f ? f.team : void 0, m = t3.initialConfig || {}, y = t3.contribution.id, p = t3.extensionContext, p.id = p.publisherId + "." + p.extensionId, "context" in e3) {
            const t4 = e3.context;
            v = t4.user, _ = t4.host;
          }
        } else {
          const t3 = e3, n3 = t3.context;
          g = n3.pageContext, f = g ? g.webContext : void 0, l = f ? f.team : void 0, m = t3.initialConfig || {}, y = t3.contributionId, p = n3.extension, v = n3.user, _ = n3.host;
        }
        e3.themeData && (J(e3.themeData), window.addEventListener("themeChanged", ((e4) => {
          J(e4.detail.data);
        }))), w(), t2();
      }));
    }));
  }
  async function j() {
    return O;
  }
  function R() {
    return u.invokeRemoteMethod("notifyLoadSucceeded", d);
  }
  function I(e2) {
    return `Attempted to call ${e2}() before init() was complete. Wait for init to complete or place within a ready() callback.`;
  }
  function T() {
    if (!v) throw new Error(I("getUser"));
    return v;
  }
  function D() {
    if (!_) throw new Error(I("getHost"));
    return _;
  }
  function S() {
    if (!p) throw new Error(I("getExtensionContext"));
    return p;
  }
  function A() {
    if (!f) throw new Error(I("getWebContext"));
    return f;
  }
  async function F(e2) {
    return j().then((() => u.invokeRemoteMethod("getService", "DevOps.ServiceManager", [e2])));
  }
  async function L() {
    return u.invokeRemoteMethod("getAccessToken", d).then(((e2) => e2.token));
  }
  function H(e2, t2) {
    const n2 = document.body;
    if (n2) {
      const o2 = "number" == typeof e2 ? e2 : n2 ? n2.scrollWidth : void 0, r2 = "number" == typeof t2 ? t2 : n2 ? n2.scrollHeight : void 0;
      u.invokeRemoteMethod("resize", d, [o2, r2]);
    }
  }
  function J(e2) {
    b || (b = document.createElement("style"), b.type = "text/css", document.head.appendChild(b));
    const t2 = [];
    if (e2) for (const n2 in e2) t2.push("--" + n2 + ": " + e2[n2]);
    b.innerText = ":root { " + t2.join("; ") + " } body { color: var(--text-primary-color) }", x("themeApplied", { detail: e2 });
  }
  u.getObjectRegistry().register("DevOps.SdkClient", { dispatchEvent: x });

  // ../ui/modules/api-versions.ts
  var ADO_REST_API_VERSIONS = ["7.1", "6.0", "5.1"];
  var EXTENSION_DATA_API_VERSION = "7.1-preview.1";
  async function fetchWithVersionFallback(buildUrl, fetchFn, options) {
    let lastError = null;
    for (const version of ADO_REST_API_VERSIONS) {
      const response = await fetchFn(buildUrl(version));
      if (response.status === 401 || response.status === 403) {
        return { response, version };
      }
      if (response.status === 400 || options.isListEndpoint && response.status === 404) {
        lastError = new Error(`API api-version=${version}: ${response.status}`);
        continue;
      }
      return { response, version };
    }
    throw lastError ?? new Error("No compatible API version found");
  }

  // ../ui/modules/sdk.ts
  var LocationServiceId = "ms.vss-features.location-service";
  var CORE_RESOURCE_AREA_ID = "79134c72-4a58-4b42-976c-04e7115f32bf";
  var sdkInitialized = false;
  var sdkReadyForCalls = false;
  var initAttemptId = 0;
  var initPromise = null;
  var cachedCollectionUri = null;
  var tokenInflight = null;
  var DEFAULT_TIMEOUT_MS = 1e4;
  function isSdkCallable() {
    return sdkInitialized || sdkReadyForCalls;
  }
  async function initializeAdoSdk(options) {
    if (sdkInitialized) return;
    if (initPromise) return initPromise;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const attemptId = ++initAttemptId;
    const initSequence = async () => {
      await k({ loaded: false });
      await j();
      if (attemptId !== initAttemptId) return;
      sdkReadyForCalls = true;
      try {
        if (options?.onReady) {
          options.onReady();
        }
        if (attemptId !== initAttemptId) return;
        await R();
      } finally {
        sdkReadyForCalls = false;
      }
      if (attemptId !== initAttemptId) return;
      sdkInitialized = true;
    };
    let timeoutId;
    const timeoutPromise = new Promise((_2, reject) => {
      timeoutId = setTimeout(() => {
        initAttemptId++;
        reject(new Error("Azure DevOps SDK initialization timed out"));
      }, timeout);
    });
    initPromise = Promise.race([initSequence(), timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
      initPromise = null;
    });
    return initPromise;
  }
  async function getExtensionDataService() {
    const collectionUri = await getCollectionUri();
    const ctx = S();
    function buildUrl(key, scopeType) {
      const scope = scopeType === "User" ? "User" : "Default";
      const scopeValue = scopeType === "User" ? "Me" : "Current";
      return `${collectionUri}_apis/ExtensionManagement/InstalledExtensions/${encodeURIComponent(ctx.publisherId)}/${encodeURIComponent(ctx.extensionId)}/Data/Scopes/${scope}/${scopeValue}/Collections/%24settings/Documents/${encodeURIComponent(key)}?api-version=${EXTENSION_DATA_API_VERSION}`;
    }
    return {
      async getValue(key, options) {
        const accessToken = await getAccessToken();
        const headers = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        };
        const url = buildUrl(key, options?.scopeType);
        const response = await fetch(url, { headers });
        if (response.status === 404) {
          return options?.defaultValue ?? void 0;
        }
        if (!response.ok) {
          throw new Error(
            `Extension data GET failed: ${response.status} ${response.statusText}`
          );
        }
        const doc = await response.json();
        if (doc !== null && typeof doc === "object" && "value" in doc) {
          return doc.value;
        }
        return doc;
      },
      async setValue(key, value, options) {
        const accessToken = await getAccessToken();
        const headers = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        };
        const url = buildUrl(key, options?.scopeType);
        const body = JSON.stringify({ id: key, value });
        const response = await fetch(url, { method: "PUT", headers, body });
        if (!response.ok) {
          throw new Error(
            `Extension data PUT failed: ${response.status} ${response.statusText}`
          );
        }
        const doc = await response.json();
        if (doc !== null && typeof doc === "object" && "value" in doc) {
          return doc.value;
        }
        return doc;
      }
    };
  }
  function getWebContext() {
    if (!isSdkCallable()) return void 0;
    const webCtx = A();
    const user = T();
    const host = D();
    return {
      project: webCtx.project ? { id: webCtx.project.id, name: webCtx.project.name } : void 0,
      team: webCtx.team ? { id: webCtx.team.id, name: webCtx.team.name } : void 0,
      user: { id: user.id, name: user.name, displayName: user.displayName },
      host: { id: host.id, name: host.name }
    };
  }
  async function getCollectionUri() {
    if (cachedCollectionUri) return cachedCollectionUri;
    const locationService = await F(LocationServiceId);
    const raw = await locationService.getResourceAreaLocation(
      CORE_RESOURCE_AREA_ID
    );
    cachedCollectionUri = raw.endsWith("/") ? raw : `${raw}/`;
    return cachedCollectionUri;
  }
  async function getAccessToken() {
    if (tokenInflight) return tokenInflight;
    tokenInflight = L();
    try {
      return await tokenInflight;
    } finally {
      tokenInflight = null;
    }
  }
  function resizeHost(width, height) {
    if (!isSdkCallable()) return;
    try {
      H(width, height);
    } catch {
    }
  }

  // ../ui/modules/shared/host-resize.ts
  var pendingHostResize = false;
  var rafHandle = null;
  var hostResizeObserver = null;
  var windowListenerAttached = false;
  var generation = 0;
  function syncHostHeight() {
    const bodyHeight = document.body.scrollHeight;
    const docHeight = document.documentElement.scrollHeight;
    const targetHeight = Math.max(bodyHeight, docHeight);
    if (targetHeight > 0) {
      resizeHost(void 0, targetHeight);
    }
  }
  function scheduleHostResize() {
    if (pendingHostResize) return;
    pendingHostResize = true;
    const gen = generation;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      if (gen !== generation) return;
      pendingHostResize = false;
      syncHostHeight();
    });
  }
  function initializeHostResizeSync(containerSelector) {
    generation++;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    pendingHostResize = false;
    hostResizeObserver?.disconnect();
    hostResizeObserver = null;
    if (typeof ResizeObserver === "function") {
      const root = document.querySelector(containerSelector);
      if (root) {
        hostResizeObserver = new ResizeObserver(() => {
          scheduleHostResize();
        });
        hostResizeObserver.observe(root);
      }
    }
    if (windowListenerAttached) {
      window.removeEventListener("resize", scheduleHostResize);
    }
    window.addEventListener("resize", scheduleHostResize);
    windowListenerAttached = true;
    scheduleHostResize();
  }

  // ../ui/error-types.ts
  var ErrorTypes = {
    SETUP_REQUIRED: "setup_required",
    MULTIPLE_PIPELINES: "multiple_pipelines",
    NO_SUCCESSFUL_BUILDS: "no_successful_builds",
    ARTIFACTS_MISSING: "artifacts_missing",
    PERMISSION_DENIED: "permission_denied",
    INVALID_CONFIG: "invalid_config"
  };
  var PrInsightsError = class extends Error {
    constructor(type, title, message, details = null) {
      super(message);
      this.name = "PrInsightsError";
      this.type = type;
      this.title = title;
      this.details = details;
    }
  };
  function createPermissionDeniedError(operation) {
    return new PrInsightsError(
      ErrorTypes.PERMISSION_DENIED,
      "Permission Denied",
      `You don't have permission to ${operation}.`,
      {
        instructions: [
          'Request "Build (Read)" permission from your project administrator',
          "Ensure you have access to view pipeline artifacts",
          "If using a service account, verify its permissions"
        ],
        permissionNeeded: "Build (Read)"
      }
    );
  }
  if (typeof window !== "undefined") {
    window.PrInsightsError = PrInsightsError;
  }

  // ../ui/modules/export.ts
  function showToast(message, type = "success", durationMs = 3e3) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  // ../ui/modules/drilldown/comparison-advisory.ts
  var CHART_CONTAINER_IDS = [
    "throughput-chart",
    "cycle-time-trend",
    "reviewer-activity"
  ];
  var SUMMARY_CARDS_SELECTOR = ".summary-cards";
  var COMPARISON_BANNER_ID = "comparison-banner";
  var BANNER_NOTE_CLASS = "comparison-advisory-banner";
  var DISABLED_ATTR = "data-drilldown-disabled";
  var DISABLED_VALUE = "comparison";
  var ADVISORY_MESSAGE = "Drill-down is unavailable during comparison. Exit comparison to use it.";
  var isActive = false;
  var activeToast = null;
  var activeToastTimer = null;
  function dismissActiveToast() {
    if (activeToastTimer !== null) {
      clearTimeout(activeToastTimer);
      activeToastTimer = null;
    }
    if (activeToast && activeToast.isConnected) {
      activeToast.remove();
    }
    activeToast = null;
  }
  function getChartContainers() {
    const out = [];
    for (const id of CHART_CONTAINER_IDS) {
      const el = document.getElementById(id);
      if (el) out.push(el);
    }
    const summary = document.querySelector(SUMMARY_CARDS_SELECTOR);
    if (summary) out.push(summary);
    return out;
  }
  function mountBanner() {
    const banner = document.getElementById(COMPARISON_BANNER_ID);
    if (!banner) return;
    if (banner.querySelector(`.${BANNER_NOTE_CLASS}`)) return;
    const note = createElement(
      "div",
      { class: BANNER_NOTE_CLASS, role: "note" },
      ADVISORY_MESSAGE
    );
    banner.appendChild(note);
  }
  function unmountBanner() {
    const banner = document.getElementById(COMPARISON_BANNER_ID);
    if (!banner) return;
    const note = banner.querySelector(`.${BANNER_NOTE_CLASS}`);
    if (note) {
      note.remove();
    }
  }
  function setChartDisabled(enabled) {
    for (const el of getChartContainers()) {
      if (enabled) {
        el.setAttribute(DISABLED_ATTR, DISABLED_VALUE);
      } else {
        el.removeAttribute(DISABLED_ATTR);
      }
    }
  }
  var comparisonListener = (evt) => {
    const e2 = evt;
    if (e2.detail.enabled) {
      isActive = true;
      mountBanner();
      setChartDisabled(true);
      if (isDetailPanelOpen()) {
        dismissDetailPanel("comparison-toggled");
      }
    } else {
      isActive = false;
      unmountBanner();
      setChartDisabled(false);
      dismissActiveToast();
    }
  };
  window.addEventListener(COMPARISON_TOGGLED_EVENT, comparisonListener);

  // ../ui/artifact-client.ts
  var LIST_ENDPOINT_FAMILIES = /* @__PURE__ */ new Set([
    "definitions",
    "builds",
    "artifacts"
  ]);
  var ArtifactClient = class {
    /**
     * Create a new ArtifactClient.
     *
     * @param projectId - Azure DevOps project ID
     */
    constructor(projectId) {
      this.collectionUri = null;
      this.tokenProvider = null;
      this.initialized = false;
      /** Per-family API version cache. Scoped to this client instance,
       *  which is bound to a single collectionUri + projectId by
       *  initialize(). A new context requires a new client instance. */
      this.resolvedApiVersions = /* @__PURE__ */ new Map();
      this.projectId = projectId;
    }
    /**
     * Initialize the client with authentication credentials.
     * MUST be called after SDK initialization and before any other methods.
     *
     * @param collectionUri - Azure DevOps collection/organization base URI
     * @param tokenProvider - Async function that returns a fresh Bearer token
     *   per request. The host manages token lifecycle; callers should pass
     *   the SDK's getAccessToken function directly.
     * @returns This client instance
     */
    async initialize(collectionUri, tokenProvider) {
      if (this.initialized) {
        return this;
      }
      this.collectionUri = collectionUri;
      this.tokenProvider = tokenProvider;
      this.initialized = true;
      return this;
    }
    /**
     * Ensure the client is initialized.
     */
    _ensureInitialized() {
      if (!this.initialized) {
        throw new Error(
          "ArtifactClient not initialized. Call initialize() first."
        );
      }
    }
    /**
     * Fetch a file from a build artifact.
     *
     * @param buildId - Build ID
     * @param artifactName - Artifact name (e.g., 'aggregates')
     * @param filePath - Path within artifact (e.g., 'dataset-manifest.json')
     * @returns Parsed JSON content
     * @throws {PrInsightsError} On permission denied or not found
     */
    async getArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "artifact-file",
        (v2) => this._buildFileUrl(buildId, artifactName, filePath, v2)
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact files");
      }
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch artifact file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Check if a specific file exists in an artifact.
     */
    async hasArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      try {
        const response = await this._fetchWithVersionFallback(
          "artifact-file",
          (v2) => this._buildFileUrl(buildId, artifactName, filePath, v2),
          { method: "HEAD" }
        );
        return response.ok;
      } catch {
        return false;
      }
    }
    /**
     * Get artifact metadata by looking it up from the artifacts list.
     */
    async getArtifactMetadata(buildId, artifactName) {
      this._ensureInitialized();
      const artifacts = await this.getArtifacts(buildId);
      const artifact = artifacts.find(
        (a2) => a2.name === artifactName
      );
      if (!artifact) {
        console.log(
          "[getArtifactMetadata] Artifact '%s' not found in build %d",
          artifactName,
          buildId
        );
        return null;
      }
      return artifact;
    }
    /**
     * Get artifact content via SDK approach.
     */
    async getArtifactFileViaSdk(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const artifact = await this.getArtifactMetadata(buildId, artifactName);
      if (!artifact) {
        throw new Error(
          `Artifact '${artifactName}' not found in build ${buildId}`
        );
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        throw new Error(
          `No downloadUrl available for artifact '${artifactName}'`
        );
      }
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      let url;
      if (downloadUrl.includes("format=")) {
        url = downloadUrl.replace(/format=\w+/, "format=file");
      } else {
        const separator = downloadUrl.includes("?") ? "&" : "?";
        url = `${downloadUrl}${separator}format=file`;
      }
      url += `&subPath=${encodeURIComponent(normalizedPath)}`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact file");
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Fetch a URL with API version fallback. If the version is already
     * cached, uses it directly. Otherwise delegates to the shared
     * fetchWithVersionFallback probe and caches on success.
     *
     * @param family Endpoint family for per-route version caching
     * @param buildUrl Function that builds the URL for a given api-version
     * @param options Optional fetch options (e.g., { method: "HEAD" })
     */
    async _fetchWithVersionFallback(family, buildUrl, options) {
      this._ensureInitialized();
      const cachedVersion = this.resolvedApiVersions.get(family);
      if (cachedVersion) {
        return this._authenticatedFetch(buildUrl(cachedVersion), options);
      }
      const isListEndpoint = LIST_ENDPOINT_FAMILIES.has(family);
      const { response, version } = await fetchWithVersionFallback(
        buildUrl,
        (url) => this._authenticatedFetch(url, options),
        { isListEndpoint }
      );
      if (response.ok) {
        this.resolvedApiVersions.set(family, version);
      }
      return response;
    }
    /**
     * Get list of artifacts for a build.
     */
    async getArtifacts(buildId) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "artifacts",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=${v2}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build artifacts");
      }
      if (response.status === 404) {
        throw new Error(`Build ${buildId} not found or has been deleted`);
      }
      if (!response.ok) {
        throw new Error(`Failed to list artifacts: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Get pipeline definitions for the project.
     *
     * @param top - Maximum number of definitions to return (default: 50)
     * @param queryOrder - Sort order (2 = lastModifiedDescending)
     * @returns Array of pipeline definition references
     */
    async getDefinitions(top = 50, queryOrder = 2) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "definitions",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/definitions?api-version=${v2}&$top=${top}&queryOrder=${queryOrder}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build definitions");
      }
      if (!response.ok) {
        throw new Error(`Failed to list definitions: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Get builds for a specific pipeline definition.
     *
     * @param definitionId - Pipeline definition ID to filter by
     * @param top - Maximum number of builds to return (default: 1)
     * @returns Array of builds (filtered to completed + succeeded)
     */
    async getBuilds(definitionId, top = 1) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "builds",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/builds?api-version=${v2}&definitions=${definitionId}&statusFilter=2&resultFilter=6&$top=${top}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list builds");
      }
      if (!response.ok) {
        throw new Error(`Failed to list builds: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Create a DatasetLoader that uses this client for authenticated requests.
     */
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(this, buildId, artifactName);
    }
    /**
     * Build the URL for accessing a file within an artifact.
     * Takes an explicit API version — callers route through
     * _fetchWithVersionFallback which provides the version.
     */
    _buildFileUrl(buildId, artifactName, filePath, apiVersion) {
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      return `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?artifactName=${encodeURIComponent(artifactName)}&%24format=file&subPath=${encodeURIComponent(normalizedPath)}&api-version=${apiVersion}`;
    }
    /**
     * Perform an authenticated fetch using the ADO auth token.
     */
    async _authenticatedFetch(url, options = {}) {
      if (!this.tokenProvider) {
        throw new Error(
          "ArtifactClient not initialized. Call initialize() first."
        );
      }
      const token = await this.tokenProvider();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...options.headers || {}
      };
      return fetch(url, { ...options, headers });
    }
    /**
     * Public wrapper for authenticated fetch.
     * Use this for external callers (e.g., dashboard raw data download).
     *
     * @param url - URL to fetch
     * @param options - Fetch options
     * @returns Response
     */
    async authenticatedFetch(url, options = {}) {
      this._ensureInitialized();
      return this._authenticatedFetch(url, options);
    }
  };
  var AuthenticatedDatasetLoader = class {
    constructor(artifactClient, buildId, artifactName) {
      this.manifest = null;
      this.dimensions = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      this.distributionCache = /* @__PURE__ */ new Map();
      this.artifactClient = artifactClient;
      this.buildId = buildId;
      this.artifactName = artifactName;
    }
    async loadManifest() {
      try {
        this.manifest = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          "dataset-manifest.json"
        );
        if (!this.manifest) {
          throw new Error("Manifest file is empty or invalid");
        }
        this.validateManifest(this.manifest);
        return this.manifest;
      } catch (error) {
        const wrappedError = new Error(
          `Failed to load dataset manifest: ${getErrorMessage(error)}`
        );
        wrappedError.cause = error;
        throw wrappedError;
      }
    }
    validateManifest(manifest) {
      const SUPPORTED_MANIFEST_VERSION = 1;
      const SUPPORTED_DATASET_VERSION = 1;
      const SUPPORTED_AGGREGATES_VERSION = 3;
      if (!manifest.manifest_schema_version) {
        throw new Error("Invalid manifest: missing schema version");
      }
      if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
        throw new Error(
          `Manifest version ${manifest.manifest_schema_version} not supported.`
        );
      }
      if (manifest.dataset_schema_version !== void 0 && manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
        throw new Error(
          `Dataset version ${manifest.dataset_schema_version} not supported.`
        );
      }
      if (manifest.aggregates_schema_version !== void 0 && manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
        throw new Error(
          `Aggregates version ${manifest.aggregates_schema_version} not supported.`
        );
      }
    }
    async loadDimensions() {
      if (this.dimensions) return this.dimensions;
      this.dimensions = await this.artifactClient.getArtifactFileViaSdk(
        this.buildId,
        this.artifactName,
        "aggregates/dimensions.json"
      );
      if (!this.dimensions) {
        throw new Error("Dimensions file is empty or invalid");
      }
      return this.dimensions;
    }
    async getWeeklyRollups(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const neededWeeks = this.getWeeksInRange(startDate, endDate);
      const results = [];
      for (const weekStr of neededWeeks) {
        const cachedRollup = this.rollupCache.get(weekStr);
        if (cachedRollup) {
          results.push(cachedRollup);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
          (r2) => r2.week === weekStr
        );
        if (!indexEntry) continue;
        try {
          const rollup = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.rollupCache.set(weekStr, rollup);
          results.push(rollup);
        } catch (e2) {
          console.warn("Failed to load rollup for %s:", weekStr, e2);
        }
      }
      return results;
    }
    async getDistributions(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const results = [];
      for (let year = startYear; year <= endYear; year++) {
        const yearStr = String(year);
        const cachedDistribution = this.distributionCache.get(yearStr);
        if (cachedDistribution) {
          results.push(cachedDistribution);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
          (d2) => d2.year === yearStr
        );
        if (!indexEntry) continue;
        try {
          const dist = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.distributionCache.set(yearStr, dist);
          results.push(dist);
        } catch (e2) {
          console.warn("Failed to load distribution for %s:", yearStr, e2);
        }
      }
      return results;
    }
    getWeeksInRange(startDate, endDate) {
      const weeks = [];
      const current = new Date(startDate);
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1);
      current.setDate(diff);
      while (current <= endDate) {
        weeks.push(this.getISOWeek(current));
        current.setDate(current.getDate() + 7);
      }
      return weeks;
    }
    getISOWeek(date) {
      const d2 = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d2.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d2.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
    getCoverage() {
      return this.manifest?.coverage || null;
    }
    getDefaultRangeDays() {
      return this.manifest?.defaults?.default_date_range_days || 90;
    }
    async loadPredictions() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.predictions;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e2) {
        console.warn("Failed to load predictions:", e2);
        return { state: "unavailable" };
      }
    }
    async loadInsights() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.ai_insights;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e2) {
        console.warn("Failed to load AI insights:", e2);
        return { state: "unavailable" };
      }
    }
  };
  var MockArtifactClient = class {
    constructor(mockData = {}) {
      this.projectId = "mock-project";
      this.initialized = true;
      this.mockData = new Map(Object.entries(mockData));
    }
    async initialize() {
      return this;
    }
    async getArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      if (this.mockData.has(key)) {
        return JSON.parse(JSON.stringify(this.mockData.get(key)));
      }
      throw new Error(`Mock: File not found: ${key}`);
    }
    async hasArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      return this.mockData.has(key);
    }
    async getArtifacts(buildId) {
      return this.mockData.get(`${buildId}/artifacts`) ?? [];
    }
    async getDefinitions() {
      return this.mockData.get("definitions") ?? [];
    }
    async getBuilds(definitionId) {
      return this.mockData.get(`builds/${definitionId}`) ?? [];
    }
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(
        this,
        buildId,
        artifactName
      );
    }
  };
  if (typeof window !== "undefined") {
    window.ArtifactClient = ArtifactClient;
    window.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
    window.MockArtifactClient = MockArtifactClient;
  }

  // ../ui/settings.ts
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var ARTIFACT_NAME_CSV = "csv-output";
  var BLOB_CLEANUP_TIMEOUT_MS = 1e4;
  var dataService = null;
  var projectDropdownAvailable = false;
  var projectList = [];
  var lastValidation = null;
  var statusTimerId = null;
  async function init() {
    initializeHostResizeSync(".settings-container");
    try {
      await initializeAdoSdk();
      syncHostHeight();
      dataService = await getExtensionDataService();
      const webCtx = getWebContext();
      const projectInput = document.getElementById(
        "project-id"
      );
      if (projectInput && webCtx?.project?.name) {
        projectInput.placeholder = `Current: ${webCtx.project.name}`;
      }
      await tryLoadProjectDropdown();
      await loadSettings();
      await updateStatus();
      setupEventListeners();
      syncHostHeight();
    } catch (error) {
      console.error("Settings initialization failed:", error);
      showStatus(
        "Failed to initialize settings: " + getErrorMessage(error),
        "error"
      );
      syncHostHeight();
    }
  }
  async function tryLoadProjectDropdown() {
    const dropdown = document.getElementById(
      "project-select"
    );
    const textInput = document.getElementById("project-id");
    try {
      const projects = await getOrganizationProjects();
      if (projects && projects.length > 0) {
        projectList = projects;
        projectDropdownAvailable = true;
        clearElement(dropdown);
        dropdown.appendChild(createOption("", "Current project (auto)"));
        for (const project of projects.sort(
          (a2, b2) => a2.name.localeCompare(b2.name)
        )) {
          const option = document.createElement("option");
          option.value = project.id;
          option.textContent = `${project.name} (${project.id.substring(0, 8)}...)`;
          dropdown.appendChild(option);
        }
        dropdown.style.display = "block";
        textInput.style.display = "none";
        console.log(`Loaded ${projects.length} projects for dropdown`);
      } else {
        throw new Error("No projects returned");
      }
    } catch (error) {
      console.log(
        "Project dropdown unavailable, using text input:",
        getErrorMessage(error)
      );
      projectDropdownAvailable = false;
      dropdown.style.display = "none";
      textInput.style.display = "block";
    }
  }
  async function getOrganizationProjects() {
    const collectionUri = await getCollectionUri();
    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    };
    const { response: firstResponse, version: workingVersion } = await fetchWithVersionFallback(
      (v2) => `${collectionUri}_apis/projects?api-version=${v2}&$top=500`,
      (url) => fetch(url, { headers }),
      { isListEndpoint: true }
    );
    if (firstResponse.status === 401 || firstResponse.status === 403) {
      throw new Error(`Failed to list projects: ${firstResponse.status}`);
    }
    if (!firstResponse.ok) {
      throw new Error(`Failed to list projects: ${firstResponse.status}`);
    }
    const allProjects = [];
    const processPage = async (response) => {
      let data;
      try {
        data = await response.json();
      } catch {
        return null;
      }
      const raw = Array.isArray(data.value) ? data.value : [];
      const page = raw.filter(
        (p2) => p2 !== null && typeof p2 === "object" && typeof p2.name === "string" && typeof p2.id === "string"
      );
      allProjects.push(...page);
      return response.headers.get("x-ms-continuationtoken") ?? null;
    };
    let continuationToken = await processPage(firstResponse);
    while (continuationToken) {
      const url = `${collectionUri}_apis/projects?api-version=${workingVersion}&$top=500&continuationToken=${encodeURIComponent(continuationToken)}`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Failed to list projects: ${response.status}`);
      }
      continuationToken = await processPage(response);
    }
    return allProjects;
  }
  async function loadSettings() {
    if (!dataService) return;
    try {
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User", defaultValue: "" }
      );
      const savedPipelineId = await dataService.getValue(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User", defaultValue: 0 }
      );
      if (savedProjectId) {
        if (projectDropdownAvailable) {
          const dropdown = document.getElementById(
            "project-select"
          );
          if (dropdown) dropdown.value = savedProjectId;
        } else {
          const textInput = document.getElementById(
            "project-id"
          );
          if (textInput) textInput.value = savedProjectId;
        }
      }
      const pipelineInput = document.getElementById(
        "pipeline-id"
      );
      if (pipelineInput && savedPipelineId) {
        pipelineInput.value = savedPipelineId.toString();
      }
    } catch (error) {
      console.log("No saved settings found:", error);
    }
  }
  function getSelectedProjectId() {
    if (projectDropdownAvailable) {
      const dropdown = document.getElementById(
        "project-select"
      );
      return dropdown.value || null;
    } else {
      const textInput = document.getElementById("project-id");
      const value = textInput.value.trim();
      return value || null;
    }
  }
  async function saveSettings() {
    if (!dataService) return;
    const projectId = getSelectedProjectId();
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    const pipelineValue = pipelineInput?.value?.trim();
    try {
      await dataService.setValue(SETTINGS_KEY_PROJECT, projectId, {
        scopeType: "User"
      });
      if (pipelineValue) {
        const pipelineId = parseInt(pipelineValue, 10);
        if (isNaN(pipelineId) || pipelineId <= 0) {
          showStatus("Pipeline ID must be a positive integer", "error");
          return;
        }
        await dataService.setValue(SETTINGS_KEY_PIPELINE, pipelineId, {
          scopeType: "User"
        });
      } else {
        await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
          scopeType: "User"
        });
      }
      showStatus("Settings saved successfully", "success");
      await updateStatus();
    } catch (error) {
      console.error("Failed to save settings:", error);
      showStatus("Failed to save settings: " + getErrorMessage(error), "error");
    }
  }
  async function clearSettings() {
    if (!dataService) return;
    if (projectDropdownAvailable) {
      const dropdown = document.getElementById(
        "project-select"
      );
      if (dropdown) dropdown.value = "";
    } else {
      const textInput = document.getElementById("project-id");
      if (textInput) textInput.value = "";
    }
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    if (pipelineInput) pipelineInput.value = "";
    try {
      await dataService.setValue(SETTINGS_KEY_PROJECT, null, {
        scopeType: "User"
      });
      await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
        scopeType: "User"
      });
      showStatus(
        "Settings cleared - using current project with auto-discovery",
        "success"
      );
      await updateStatus();
    } catch (error) {
      console.error("Failed to clear settings:", error);
      showStatus("Failed to clear settings: " + getErrorMessage(error), "error");
    }
  }
  async function updateStatus() {
    if (!dataService) return;
    const statusDisplay = document.getElementById("status-display");
    if (!statusDisplay) return;
    try {
      let savedProjectId = "";
      let savedPipelineId = 0;
      try {
        savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, {
          scopeType: "User",
          defaultValue: ""
        }) || "";
        savedPipelineId = await dataService.getValue(SETTINGS_KEY_PIPELINE, {
          scopeType: "User",
          defaultValue: 0
        }) || 0;
      } catch (readError) {
        console.warn("Could not read saved settings:", readError);
      }
      const webContext = getWebContext();
      const currentProjectName = webContext?.project?.name || "Unknown";
      const currentProjectId = webContext?.project?.id;
      let html = "";
      html += `<p><strong>Current Project:</strong> ${escapeHtml(currentProjectName)}</p>`;
      if (savedProjectId) {
        const projectName = getProjectNameById(savedProjectId);
        html += `<p><strong>Source Project:</strong> ${escapeHtml(projectName)} <code>${savedProjectId.substring(0, 8)}...</code></p>`;
      } else {
        html += `<p><strong>Source Project:</strong> <em>Same as current</em></p>`;
      }
      if (savedPipelineId) {
        html += `<p><strong>Pipeline Definition ID:</strong> ${savedPipelineId}`;
        lastValidation = null;
        const downloadBtn2 = document.getElementById(
          "download-raw-btn"
        );
        if (downloadBtn2) {
          downloadBtn2.disabled = true;
        }
        const targetProjectId = savedProjectId || currentProjectId;
        if (targetProjectId) {
          const validation = await validatePipeline(
            savedPipelineId,
            targetProjectId
          );
          lastValidation = {
            valid: validation.valid,
            buildId: validation.buildId
          };
          if (validation.valid) {
            html += ` <span class="status-valid">\u2713 Valid</span>`;
            html += `</p>`;
            html += `<p class="status-hint">Pipeline: "${escapeHtml(validation.name || "")}" (Build #${validation.buildId})</p>`;
          } else {
            html += ` <span class="status-invalid">\u26A0\uFE0F Invalid</span>`;
            html += `</p>`;
            html += `<p class="status-warning">\u26A0\uFE0F ${escapeHtml(validation.error || "")}</p>`;
            html += `<p class="status-hint">The dashboard will automatically clear this setting and re-discover pipelines. Consider clearing manually to configure a different pipeline.</p>`;
          }
        } else {
          lastValidation = null;
          html += `</p><p class="status-warning">\u26A0\uFE0F No project ID available for validation</p>`;
        }
      } else {
        html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
        const result = await discoverPipelines(
          savedProjectId || currentProjectId
        );
        if (result.error) {
          lastValidation = null;
          html += `<p class="status-warning">\u26A0\uFE0F Discovery failed: ${escapeHtml(result.error)}</p>`;
          html += `<p class="status-hint"><a href="#" id="retry-discovery-link">Retry</a></p>`;
        } else {
          const match = result.pipelines[0];
          if (match) {
            lastValidation = { valid: true, buildId: match.buildId };
            html += `<p class="status-hint">Found pipeline "${escapeHtml(match.name)}" (Build #${match.buildId}). Download available.</p>`;
          } else {
            lastValidation = null;
            html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
          }
          if (result.skippedCount > 0) {
            html += `<p class="status-warning">\u26A0\uFE0F Found ${result.pipelines.length} pipeline(s); ${result.skippedCount} could not be checked.</p>`;
          }
        }
      }
      const downloadBtn = document.getElementById(
        "download-raw-btn"
      );
      if (downloadBtn) {
        downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
      }
      if (projectDropdownAvailable) {
        html += `<p class="status-hint">\u2713 Project dropdown available (${projectList.length} projects)</p>`;
      } else {
        html += `<p class="status-hint">Project dropdown not available - using text input</p>`;
      }
      renderTrustedHtml(statusDisplay, html);
      const retryLink = document.getElementById("retry-discovery-link");
      if (retryLink) {
        retryLink.addEventListener("click", (e2) => {
          e2.preventDefault();
          void updateStatus();
        });
      }
    } catch (error) {
      renderTrustedHtml(
        statusDisplay,
        `<p class="status-error">Failed to load status: ${escapeHtml(getErrorMessage(error))}</p>`
      );
    }
  }
  function getProjectNameById(projectId) {
    const project = projectList.find((p2) => p2.id === projectId);
    return project?.name || projectId;
  }
  async function downloadRawData() {
    if (!lastValidation?.valid || !lastValidation?.buildId) {
      showToast("No valid pipeline configured. Save settings first.", "error");
      return;
    }
    const downloadBtn = document.getElementById(
      "download-raw-btn"
    );
    const originalText = downloadBtn?.textContent || "";
    try {
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Downloading...";
      }
      showToast("Preparing download...", "success");
      if (!dataService) {
        showToast("Settings service not available", "error");
        return;
      }
      let savedProjectId = "";
      try {
        savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, {
          scopeType: "User",
          defaultValue: ""
        }) || "";
      } catch {
        console.warn("Could not read saved project setting for download");
      }
      const webContext = getWebContext();
      const projectId = savedProjectId || webContext?.project?.id;
      if (!projectId) {
        showToast("No project ID available", "error");
        return;
      }
      if (!Number.isInteger(lastValidation.buildId) || lastValidation.buildId <= 0) {
        showToast("Invalid build ID", "error");
        return;
      }
      const collectionUri = await getCollectionUri();
      const artifactClient = new ArtifactClient(projectId);
      await artifactClient.initialize(collectionUri, getAccessToken);
      const artifact = await artifactClient.getArtifactMetadata(
        lastValidation.buildId,
        ARTIFACT_NAME_CSV
      );
      if (!artifact) {
        showToast("Raw CSV artifact not found in this pipeline run", "error");
        return;
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        showToast("Download URL not available", "error");
        return;
      }
      try {
        const parsed = new URL(downloadUrl);
        if (parsed.protocol !== "https:") {
          showToast("Invalid download URL", "error");
          return;
        }
        const collectionOrigin = new URL(collectionUri).origin;
        const isCollectionHost = parsed.origin === collectionOrigin;
        const isAzureArtifactHost = parsed.hostname.endsWith(
          ".artifacts.visualstudio.com"
        );
        if (!isCollectionHost && !isAzureArtifactHost) {
          showToast("Invalid download URL", "error");
          return;
        }
      } catch {
        showToast("Invalid download URL", "error");
        return;
      }
      const zipUrlObj = new URL(downloadUrl);
      if (!zipUrlObj.searchParams.has("format")) {
        zipUrlObj.searchParams.set("format", "zip");
      }
      const zipUrl = zipUrlObj.toString();
      const response = await artifactClient.authenticatedFetch(zipUrl);
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          showToast("Permission denied to download artifacts", "error");
        } else {
          showToast(`Download failed: ${response.statusText}`, "error");
        }
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      link.download = `pr-insights-raw-data-${dateStr}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), BLOB_CLEANUP_TIMEOUT_MS);
      showToast("Download started", "success");
    } catch (err) {
      console.error("Failed to download raw data:", getErrorMessage(err));
      showToast("Failed to download raw data", "error");
    } finally {
      if (downloadBtn) {
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
      }
    }
  }
  async function validatePipeline(pipelineId, projectId) {
    const client = new ArtifactClient(projectId);
    try {
      const collectionUri = await getCollectionUri();
      await client.initialize(collectionUri, getAccessToken);
    } catch (e2) {
      return { valid: false, error: `Validation error: ${getErrorMessage(e2)}` };
    }
    try {
      const builds = await client.getBuilds(pipelineId);
      if (!builds || builds.length === 0) {
        return {
          valid: false,
          error: "No successful builds found (pipeline may not exist or has no completed runs)"
        };
      }
      const firstBuild = builds[0];
      if (!firstBuild) {
        return { valid: false, error: "Build unexpectedly empty" };
      }
      const pipelineName = firstBuild.definition?.name || `ID ${pipelineId}`;
      return {
        valid: true,
        name: pipelineName,
        buildId: firstBuild.id
      };
    } catch (e2) {
      return { valid: false, error: `Build check failed: ${getErrorMessage(e2)}` };
    }
  }
  async function discoverPipelines(targetProjectId) {
    const webContext = getWebContext();
    const projectId = targetProjectId || webContext?.project?.id;
    if (!projectId) {
      return { pipelines: [], skippedCount: 0, error: "No project ID available" };
    }
    const collectionUri = await getCollectionUri();
    const client = new ArtifactClient(projectId);
    try {
      await client.initialize(collectionUri, getAccessToken);
    } catch (e2) {
      return {
        pipelines: [],
        skippedCount: 0,
        error: `Failed to initialize: ${getErrorMessage(e2)}`
      };
    }
    let skippedCount = 0;
    const pipelines = [];
    let definitions;
    try {
      definitions = await client.getDefinitions();
    } catch (e2) {
      return {
        pipelines: [],
        skippedCount: 0,
        error: `Failed to list pipelines: ${getErrorMessage(e2)}`
      };
    }
    for (const def of definitions) {
      try {
        const builds = await client.getBuilds(def.id);
        if (!builds || builds.length === 0) continue;
        const latestBuild = builds[0];
        if (!latestBuild) continue;
        const artifacts = await client.getArtifacts(latestBuild.id);
        if (!artifacts.some((a2) => a2.name === "aggregates"))
          continue;
        pipelines.push({
          id: def.id,
          name: def.name,
          buildId: latestBuild.id
        });
      } catch (e2) {
        skippedCount++;
        console.debug("Skipping pipeline %s:", def.name, e2);
      }
    }
    return { pipelines, skippedCount };
  }
  async function runDiscovery() {
    const statusDisplay = document.getElementById("status-display");
    if (!statusDisplay) return;
    const originalContent = statusDisplay.innerHTML;
    renderTrustedHtml(
      statusDisplay,
      "<p>\u{1F50D} Discovering pipelines with aggregates artifact...</p>"
    );
    try {
      const result = await discoverPipelines();
      if (result.error) {
        let errorHtml = `<p class="status-warning">\u26A0\uFE0F Discovery failed: ${escapeHtml(result.error)}</p>`;
        errorHtml += `<p class="status-hint"><a href="#" id="retry-run-discovery-link">Retry</a></p>`;
        renderTrustedHtml(statusDisplay, errorHtml);
        const retryLink = document.getElementById("retry-run-discovery-link");
        if (retryLink) {
          retryLink.addEventListener("click", (e2) => {
            e2.preventDefault();
            void runDiscovery();
          });
        }
        showStatus("Discovery failed: " + result.error, "error");
        return;
      }
      if (result.pipelines.length === 0) {
        renderTrustedHtml(
          statusDisplay,
          `
                <p class="status-warning">\u26A0\uFE0F No PR Insights pipelines found in the current project.</p>
                <p class="status-hint">Create a pipeline using pr-insights-pipeline.yml and run it at least once.</p>
            `
        );
        showStatus("No pipelines found with aggregates artifact", "warning");
        return;
      }
      let html = `<p><strong>Found ${result.pipelines.length} pipeline(s):</strong></p>`;
      if (result.skippedCount > 0) {
        html += `<p class="status-warning">\u26A0\uFE0F ${result.skippedCount} pipeline(s) could not be checked.</p>`;
      }
      html += `<ul class="discovered-pipelines">`;
      for (const match of result.pipelines) {
        html += `<li>
                <strong>${escapeHtml(match.name)}</strong> (ID: ${match.id})
                <button class="btn btn-small" id="select-pipeline-${match.id}">Use This</button>
            </li>`;
      }
      html += "</ul>";
      html += '<p class="status-hint">Click "Use This" to configure, or clear settings for auto-discovery.</p>';
      renderTrustedHtml(statusDisplay, html);
      for (const match of result.pipelines) {
        document.getElementById(`select-pipeline-${match.id}`)?.addEventListener("click", () => {
          const pipelineInput = document.getElementById(
            "pipeline-id"
          );
          if (pipelineInput) pipelineInput.value = match.id.toString();
          showStatus(
            `Pipeline ${match.id} selected - click Save to confirm`,
            "info"
          );
        });
      }
      showStatus(`Found ${result.pipelines.length} pipeline(s)`, "success");
    } catch (error) {
      renderTrustedHtml(statusDisplay, originalContent);
      showStatus("Discovery failed: " + getErrorMessage(error), "error");
    }
  }
  function showStatus(message, type = "info") {
    const statusEl = document.getElementById("status-message");
    if (!statusEl) return;
    if (statusTimerId !== null) clearTimeout(statusTimerId);
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;
    statusTimerId = setTimeout(() => {
      statusTimerId = null;
      statusEl.textContent = "";
      statusEl.className = "status-message";
    }, 5e3);
  }
  function setupEventListeners() {
    document.getElementById("save-btn")?.addEventListener("click", () => void saveSettings());
    document.getElementById("clear-btn")?.addEventListener("click", () => void clearSettings());
    document.getElementById("discover-btn")?.addEventListener("click", () => void runDiscovery());
    document.getElementById("download-raw-btn")?.addEventListener("click", () => void downloadRawData());
    document.getElementById("pipeline-id")?.addEventListener("keypress", (e2) => {
      if (e2.key === "Enter") {
        void saveSettings();
      }
    });
    document.getElementById("project-id")?.addEventListener("keypress", (e2) => {
      if (e2.key === "Enter") {
        void saveSettings();
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
  window.selectDiscoveredPipeline = (pipelineId) => {
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    if (pipelineInput) pipelineInput.value = pipelineId.toString();
    showStatus(`Pipeline ${pipelineId} selected - click Save to confirm`, "info");
  };
})();
// Global exports for browser runtime\nif (typeof window !== 'undefined') { Object.assign(window, PRInsightsSettings || {}); }
