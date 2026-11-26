// Answers `navigator.credentials` for passkeys in Athas browser tabs.
//
// WKWebView keeps WebAuthn to apps with Apple's browser entitlement, so this script hands
// passkey requests to Athas, which asks the user and signs with keys it keeps in the keychain.
// Athas checks every request against the address of the page it reads from the webview; nothing
// here is trusted.
(() => {
  if (window.top !== window || window.__athasPasskeys) return;
  Object.defineProperty(window, "__athasPasskeys", { value: true });

  const pending = new Map();
  let nextRequest = 1;

  const post = (message) => window.ipc.postMessage(JSON.stringify(message));
  const abortError = (signal) =>
    signal && signal.reason !== undefined
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");

  const bytesOf = (source) => {
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (ArrayBuffer.isView(source)) {
      return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    }
    throw new TypeError("Expected an ArrayBuffer or a typed array.");
  };
  const encode = (source) => {
    let text = "";
    for (const byte of bytesOf(source)) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const decode = (text) => {
    const binary = atob(
      text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4),
    );
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  };

  const descriptors = (list) =>
    Array.isArray(list)
      ? list.map((descriptor) => ({ type: descriptor.type, id: encode(descriptor.id) }))
      : [];

  const creationOptions = (options) => ({
    rp: { id: options.rp && options.rp.id, name: options.rp && options.rp.name },
    user: {
      id: encode(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    challenge: encode(options.challenge),
    pubKeyCredParams: (options.pubKeyCredParams || []).map((param) => ({
      type: param.type,
      alg: param.alg,
    })),
    excludeCredentials: descriptors(options.excludeCredentials),
    extensions: { credProps: !!(options.extensions && options.extensions.credProps) },
  });

  const requestOptions = (options) => ({
    challenge: encode(options.challenge),
    rpId: options.rpId,
    allowCredentials: descriptors(options.allowCredentials),
  });

  const native = {
    credential: window.PublicKeyCredential,
    attestation: window.AuthenticatorAttestationResponse,
    assertion: window.AuthenticatorAssertionResponse,
  };
  // Results read as the platform's own types to `instanceof`; their own fields shadow the
  // platform's getters.
  const adopt = (object, type) => {
    try {
      if (typeof type === "function" && type.prototype) Object.setPrototypeOf(object, type.prototype);
    } catch {}
    return object;
  };

  const credentialFrom = (json, created) => {
    const raw = json.response;
    const response = created
      ? {
          clientDataJSON: decode(raw.clientDataJSON),
          attestationObject: decode(raw.attestationObject),
          getTransports: () => raw.transports.slice(),
          getAuthenticatorData: () => decode(raw.authenticatorData),
          getPublicKey: () => decode(raw.publicKey),
          getPublicKeyAlgorithm: () => raw.publicKeyAlgorithm,
        }
      : {
          clientDataJSON: decode(raw.clientDataJSON),
          authenticatorData: decode(raw.authenticatorData),
          signature: decode(raw.signature),
          userHandle: raw.userHandle ? decode(raw.userHandle) : null,
        };
    const credential = {
      id: json.id,
      rawId: decode(json.rawId),
      type: "public-key",
      authenticatorAttachment: json.authenticatorAttachment,
      response: adopt(response, created ? native.attestation : native.assertion),
      getClientExtensionResults: () => JSON.parse(JSON.stringify(json.clientExtensionResults || {})),
      toJSON: () => JSON.parse(JSON.stringify(json)),
    };
    return adopt(credential, native.credential);
  };

  Object.defineProperty(window, "__athasPasskeyResolve", {
    value: (requestId, result, error) => {
      const request = pending.get(requestId);
      if (!request) return;
      pending.delete(requestId);
      if (error) {
        request.reject(new DOMException(error.message, error.name));
      } else {
        try {
          request.resolve(credentialFrom(result, request.created));
        } catch (failure) {
          request.reject(new DOMException(String(failure), "UnknownError"));
        }
      }
    },
  });

  const ask = (op, options, signal) =>
    new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(abortError(signal));
        return;
      }
      const requestId = nextRequest++;
      pending.set(requestId, { resolve, reject, created: op === "create" });
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            if (!pending.delete(requestId)) return;
            post({ kind: "passkeyCancel", requestId });
            reject(abortError(signal));
          },
          { once: true },
        );
      }
      post({ kind: "passkey", op, requestId, origin: location.origin, options });
    });

  const container = navigator.credentials;
  const platformCreate = container && container.create ? container.create.bind(container) : null;
  const platformGet = container && container.get ? container.get.bind(container) : null;

  const create = (options) => {
    if (!options || !options.publicKey) {
      return platformCreate
        ? platformCreate(options)
        : Promise.reject(new DOMException("Only passkeys are supported.", "NotSupportedError"));
    }
    let request;
    try {
      request = creationOptions(options.publicKey);
    } catch (error) {
      return Promise.reject(error instanceof TypeError ? error : new TypeError(String(error)));
    }
    return ask("create", request, options.signal);
  };

  const get = (options) => {
    if (!options || !options.publicKey) {
      return platformGet ? platformGet(options) : Promise.resolve(null);
    }
    // Athas has no passkey autofill, and says so; a page that asks anyway waits until it gives up.
    if (options.mediation === "conditional") {
      return new Promise((_, reject) => {
        if (options.signal) {
          options.signal.addEventListener("abort", () => reject(abortError(options.signal)), {
            once: true,
          });
        }
      });
    }
    let request;
    try {
      request = requestOptions(options.publicKey);
    } catch (error) {
      return Promise.reject(error instanceof TypeError ? error : new TypeError(String(error)));
    }
    return ask("get", request, options.signal);
  };

  if (container) {
    Object.defineProperty(container, "create", { value: create, configurable: true, writable: true });
    Object.defineProperty(container, "get", { value: get, configurable: true, writable: true });
  } else {
    Object.defineProperty(navigator, "credentials", {
      value: { create, get, store: () => Promise.resolve(), preventSilentAccess: () => Promise.resolve() },
      configurable: true,
    });
  }

  // A page sees a platform authenticator that verifies the user, and no autofill.
  let credentialType = native.credential;
  if (typeof credentialType !== "function") {
    credentialType = function PublicKeyCredential() {
      throw new TypeError("Illegal constructor");
    };
    window.PublicKeyCredential = credentialType;
    native.credential = credentialType;
  }
  const statics = {
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    isConditionalMediationAvailable: () => Promise.resolve(false),
    getClientCapabilities: () =>
      Promise.resolve({
        conditionalCreate: false,
        conditionalGet: false,
        hybridTransport: false,
        passkeyPlatformAuthenticator: true,
        userVerifyingPlatformAuthenticator: true,
        relatedOrigins: false,
        signalAllAcceptedCredentials: false,
        signalCurrentUserDetails: false,
        signalUnknownCredential: false,
      }),
    parseCreationOptionsFromJSON: (json) => ({
      ...json,
      challenge: decode(json.challenge),
      user: { ...json.user, id: decode(json.user.id) },
      excludeCredentials: (json.excludeCredentials || []).map((item) => ({ ...item, id: decode(item.id) })),
    }),
    parseRequestOptionsFromJSON: (json) => ({
      ...json,
      challenge: decode(json.challenge),
      allowCredentials: (json.allowCredentials || []).map((item) => ({ ...item, id: decode(item.id) })),
    }),
  };
  for (const [name, value] of Object.entries(statics)) {
    try {
      Object.defineProperty(credentialType, name, { value, configurable: true, writable: true });
    } catch {}
  }
})();
