

export async function tryAutomationEvent(orderId: string, event: string): Promise<void> {
    try {
        const { handleEvent } = await import("./job.service");
        await handleEvent(orderId, event);
    } catch (e) {
        console.error(`[Job] event ${event} failed for ${orderId}`, e);
    }
}
