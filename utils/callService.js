const fetch = globalThis.fetch || require('node-fetch');

/**
 * Triggers an actual outbound phone call using Vapi, Retell, or HTTP fetch request to a voice gateway.
 * Dials the target phone number (`DEMO_TARGET_PHONE` from .env) with the generated emergency script.
 * 
 * @param {string} phoneNumber - Default or fallback phone number
 * @param {string} script - The emergency text script to be spoken in the call
 * @returns {Promise<object>} Outbound call execution result
 */
async function makeOutboundCall(phoneNumber, script) {
    // 1. Resolve Target Phone Number: Prefer DEMO_TARGET_PHONE from .env
    const targetPhone = process.env.DEMO_TARGET_PHONE || phoneNumber || process.env.DEFAULT_FALLBACK_PHONE || "+918793399509";
    
    // Voice gateway endpoints & API Keys from process.env
    const voiceGatewayUrl = process.env.VOICE_GATEWAY_URL || "https://api.vapi.ai/call/phone";
    const vapiApiKey = process.env.VAPI_API_KEY;
    const retellApiKey = process.env.RETELL_API_KEY;

    console.log(`\n======================================================`);
    console.log(`[OUTBOUND CALL TRIGGER] Initiating call to: ${targetPhone}`);
    console.log(`[OUTBOUND SCRIPT] "${script}"`);
    console.log(`======================================================\n`);

    let responseData = null;
    let success = false;
    let gatewayUsed = "HTTP Voice Gateway";

    try {
        if (vapiApiKey && vapiApiKey !== "your_vapi_api_key_here") {
            gatewayUsed = "Vapi.ai Voice Gateway";
            console.log(`[Voice Gateway] Dispatching via Vapi.ai to ${targetPhone}...`);
            const res = await fetch("https://api.vapi.ai/call/phone", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${vapiApiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    phoneNumber: targetPhone,
                    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || undefined,
                    assistant: {
                        firstMessage: script,
                        model: {
                            provider: "openai",
                            model: "gpt-3.5-turbo",
                            messages: [
                                { role: "system", content: "You are an emergency pet triage dispatch AI caller. Read the emergency notification script clearly to the recipient." }
                            ]
                        }
                    }
                })
            });
            responseData = await res.json();
            success = res.ok;
        } else if (retellApiKey && retellApiKey !== "your_retell_api_key_here") {
            gatewayUsed = "Retell AI Voice Gateway";
            console.log(`[Voice Gateway] Dispatching via Retell AI to ${targetPhone}...`);
            const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${retellApiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    to_number: targetPhone,
                    override_agent_id: process.env.RETELL_AGENT_ID,
                    retell_llm_dynamic_variables: { emergency_script: script }
                })
            });
            responseData = await res.json();
            success = res.ok;
        } else {
            // Generic / Fallback Voice Gateway HTTP Fetch Request
            gatewayUsed = `HTTP Fetch Gateway (${voiceGatewayUrl})`;
            console.log(`[Voice Gateway] Dispatching HTTP fetch request to ${voiceGatewayUrl} for target ${targetPhone}...`);
            const res = await fetch(voiceGatewayUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-Key": process.env.VOICE_GATEWAY_API_KEY || "demo-key"
                },
                body: JSON.stringify({
                    targetPhone: targetPhone,
                    phone: targetPhone,
                    script: script,
                    message: script,
                    timestamp: new Date().toISOString()
                })
            });
            
            const rawText = await res.text();
            try {
                responseData = JSON.parse(rawText);
            } catch (e) {
                responseData = { status: res.status, statusText: res.statusText, bodyText: rawText };
            }
            success = res.ok;
        }
    } catch (err) {
        console.error(`[Voice Gateway] Exception during outbound API call: ${err.message}`);
        responseData = { error: err.message };
        success = false;
    }

    const result = {
        success,
        targetPhone,
        gatewayUsed,
        callScript: script,
        response: responseData,
        timestamp: new Date().toISOString()
    };

    console.log(`[OUTBOUND CALL RESULT] Success: ${success} | Gateway: ${gatewayUsed}`);
    return result;
}

module.exports = {
    makeOutboundCall
};
