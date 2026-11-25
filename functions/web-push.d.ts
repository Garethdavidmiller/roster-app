// The part of `web-push` that push.js calls, typed. The package ships no declarations, and the
// community `@types/web-push` would be a new dependency of the deployed bundle for two functions.
// Read only by the type-checker (functions/jsconfig.json); nothing loads this file at run time.
// Signatures follow web-push 3.x/4.x (src/index.js → src/web-push-lib.js).
declare module 'web-push' {
    export interface PushSubscription {
        endpoint: string;
        keys: { p256dh: string; auth: string };
    }

    export interface RequestOptions {
        /** Milliseconds before the request to the push service is abandoned. */
        timeout?: number;
        /** Seconds the push service may hold the message for an offline device. */
        TTL?: number;
    }

    export interface SendResult {
        statusCode: number;
        body: string;
        headers: Record<string, string>;
    }

    export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;

    /** Rejects with a WebPushError, whose `statusCode` is the push service's HTTP answer. */
    export function sendNotification(
        subscription: PushSubscription,
        payload?: string | Buffer | null,
        options?: RequestOptions,
    ): Promise<SendResult>;
}
