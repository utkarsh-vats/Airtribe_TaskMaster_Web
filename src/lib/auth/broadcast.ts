/*
 * Cross-tab auth sync (DESIGN.md §3) over BroadcastChannel('tm-auth'):
 *   'signed-out' → other tabs drop their session and go to /login
 *   'signed-in'  → other tabs sitting on /login or /register go to the dashboard
 * A no-op where BroadcastChannel isn't available. Messages carry the sender's tab id so a tab
 * never reacts to its own.
 */

export type AuthBroadcast = 'signed-out' | 'signed-in';
type Message = { type: AuthBroadcast; tabId: string };

const CHANNEL_NAME = 'tm-auth';

/** Random per page load. */
export const TAB_ID = typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random());

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
    if (channel === undefined) {
        channel =
            typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    }
    return channel;
}

export function broadcastAuth(type: AuthBroadcast) {
    const message: Message = { type, tabId: TAB_ID };
    getChannel()?.postMessage(message);
}

function isMessage(data: unknown): data is Message {
    return (
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        (data.type === 'signed-out' || data.type === 'signed-in') &&
        'tabId' in data &&
        typeof data.tabId === 'string'
    );
}

/** Call `onMessage` for other tabs' auth messages. Returns an unsubscribe function. */
export function onAuthBroadcast(onMessage: (type: AuthBroadcast) => void): () => void {
    const source = getChannel();
    if (!source) return () => {};
    const listener = (event: MessageEvent<unknown>) => {
        if (isMessage(event.data) && event.data.tabId !== TAB_ID) onMessage(event.data.type);
    };
    source.addEventListener('message', listener);
    return () => source.removeEventListener('message', listener);
}

/** Tests only: close the channel so the next use opens a fresh one. */
export function closeAuthChannelForTests() {
    channel?.close();
    channel = undefined;
}
