// Ponte tra il gioco Godot e il client Discord (Embedded App SDK v2).
//
// Dentro un'Activity l'iframe è su https://<app-id>.discordsays.com e non può
// chiamare domini esterni: l'SDK viene quindi servito da ./vendor/discord-sdk.js
// (bundle locale, nessuna richiesta a CDN) e lo scambio del code OAuth2 avviene
// con PKCE verso https://discord.com/api/, che è esente dal proxy.
//
// Fuori da Discord questo file non fa nulla: nessun errore sulle build normali.

import { DiscordSDK } from "./vendor/discord-sdk.js";

const CLIENT_ID = "1575150016815693927";

const state = {
	inside: location.hostname.endsWith("discordsays.com"),
	ready: false,
	authenticated: false,
	user: null,
	instanceId: null,
	error: null,
};

// Godot legge questo oggetto con JavaScriptBridge:
//   JSON.parse(JavaScriptBridge.eval("window.cameraDiscordJson()"))
window.cameraDiscord = state;
window.cameraDiscordJson = () => JSON.stringify(state);

function base64Url(bytes) {
	let text = "";
	for (const byte of bytes) text += String.fromCharCode(byte);
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeVerifier(length = 64) {
	const bytes = new Uint8Array(64);
	crypto.getRandomValues(bytes);
	return base64Url(bytes).slice(0, length);
}

async function makeChallenge(verifier) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64Url(new Uint8Array(digest));
}

async function exchangeCode(code, verifier) {
	const response = await fetch("https://discord.com/api/oauth2/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
		}),
	});
	if (!response.ok) {
		throw new Error(`scambio token HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
	}
	const payload = await response.json();
	if (!payload.access_token) throw new Error("nessun access_token nella risposta");
	return payload.access_token;
}

async function connect() {
	if (!state.inside) {
		console.log("[camera] fuori da Discord: Embedded App SDK non avviato");
		return;
	}
	try {
		const sdk = new DiscordSDK(CLIENT_ID);
		state.instanceId = sdk.instanceId ?? null;

		await sdk.ready();
		state.ready = true;
		console.log("[camera] SDK pronto, instance", state.instanceId);

		const verifier = makeVerifier();
		const { code } = await sdk.commands.authorize({
			client_id: CLIENT_ID,
			response_type: "code",
			state: "",
			prompt: "none",
			scope: ["identify"],
			code_challenge: await makeChallenge(verifier),
			code_challenge_method: "S256",
		});

		const accessToken = await exchangeCode(code, verifier);
		const auth = await sdk.commands.authenticate({ access_token: accessToken });

		state.user = {
			id: auth.user.id,
			username: auth.user.username,
			name: auth.user.global_name ?? auth.user.username,
		};
		state.authenticated = true;
		console.log("[camera] autenticato come", state.user.username);
	} catch (error) {
		state.error = String(error && error.message ? error.message : error);
		console.warn("[camera] Embedded App SDK:", state.error);
	}
}

connect();
