require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');

// Optional SDK imports for Snowflake & Solana
const snowflake = require('snowflake-sdk');
const solanaWeb3 = require('@solana/web3.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 1. Initialize Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

// Load mock database dynamically
let dogRegistry = require('./data/mock_registry.json');

// Snowflake Connection Pool Setup
const snowflakePool = snowflake.createPool({
    account: process.env.SNOWFLAKE_ACCOUNT || 'mock_account',
    username: process.env.SNOWFLAKE_USERNAME || 'mock_user',
    password: process.env.SNOWFLAKE_PASSWORD || 'mock_password',
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
    database: process.env.SNOWFLAKE_DATABASE || 'PAWID_DB',
    schema: process.env.SNOWFLAKE_SCHEMA || 'PUBLIC'
}, { min: 1, max: 5 });

function executeSnowflakeQuery(sqlText, binds = []) {
    return new Promise((resolve, reject) => {
        snowflakePool.use(async (client) => {
            client.execute({
                sqlText: sqlText,
                binds: binds,
                complete: (err, stmt, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            });
        });
    });
}

app.post('/api/report-dog', async (req, res) => {
    try {
        const { imageBase64 } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ success: false, error: "No image provided." });
        }

        const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

        // 1. GOOGLE AI VISION ANALYSIS (Best use of Google AI)
        const prompt = `
        You are an expert AI veterinary and animal biometrics assistant for "PawID & Care".
        Analyze this uploaded image of a dog. 
        Here is our existing database registry for comparison:
        ${JSON.stringify(dogRegistry, null, 2)}

        Perform the following tasks and return ONLY a valid JSON response (no markdown blocks, just raw JSON):
        {
          "matchedDogId": "String (Match the closest dogId from registry, or generate a new ID like MUM-999 if it's a completely new stray)",
          "isNewDog": boolean,
          "detectedType": "STRAY" or "PET",
          "visualAnalysis": {
            "breedOrCoat": "Brief description of coat and features",
            "distinctiveMarks": "Scars, collar, ear notches, etc."
          },
          "urgencyLevel": "LOW", "MEDIUM", or "HIGH",
          "injuryDetected": "Description of any injury or 'None'",
          "recommendedAction": "Short text instruction for rescuers or owners"
        }
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: [
                {
                    inlineData: { mimeType: 'image/jpeg', data: base64Data }
                },
                prompt
            ]
        });

        let aiResultText = response.text.trim();
        aiResultText = aiResultText.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
        const analysis = JSON.parse(aiResultText);

        let profile = dogRegistry.find(d => d.dogId === analysis.matchedDogId);

        // If it's a new dog, build profile and save it to mock_registry.json automatically
        if (!profile) {
            profile = {
                dogId: analysis.matchedDogId,
                type: analysis.detectedType,
                name: analysis.detectedType === "PET" ? "Unknown Pet" : "New Community Stray",
                visualSignature: analysis.visualAnalysis.breedOrCoat,
                vaccinationStatus: "🔴 Unknown / Overdue",
                medicalHistory: analysis.injuryDetected,
                lastSeen: new Date().toISOString().split('T')[0]
            };

            // Push and persist to disk
            dogRegistry.push(profile);
            try {
                const filePath = path.join(__dirname, 'data', 'mock_registry.json');
                fs.writeFileSync(filePath, JSON.stringify(dogRegistry, null, 2), 'utf-8');
                console.log(`Successfully saved new dog ${profile.dogId} to mock_registry.json`);
            } catch (writeErr) {
                console.error("Failed to save to mock registry file:", writeErr.message);
            }
        }

        // 2. SOLANA DEVNET HASH ANCHORING (Best use of Solana)
        let solanaTxSignature = "simulated_devnet_tx";
        try {
            const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
            const payer = solanaWeb3.Keypair.generate();
            const airdropSignature = await connection.requestAirdrop(payer.publicKey, solanaWeb3.LAMPORTS_PER_SOL / 10);
            await connection.confirmTransaction(airdropSignature);

            const recordData = JSON.stringify({ dogId: profile.dogId, status: profile.vaccinationStatus, time: Date.now() });
            const dataHash = crypto.createHash('sha256').update(recordData).digest('hex');

            const transaction = new solanaWeb3.Transaction().add(
                new solanaWeb3.TransactionInstruction({
                    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
                    programId: new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
                    data: Buffer.from(`PawID Record Hash: ${dataHash}`, 'utf-8'),
                })
            );

            solanaTxSignature = await solanaWeb3.sendAndConfirmTransaction(connection, transaction, [payer]);
        } catch (solanaErr) {
            console.log("Solana Devnet notice:", solanaErr.message);
        }

        // 3. SNOWFLAKE ANALYTICS & VACCINATION LOGGING (Best use of Snowflake)
        let herdImmunityScore = "78% (Estimated Neighborhood Average)";
        try {
            await executeSnowflakeQuery(
                `INSERT INTO dog_scans (dog_id, scan_type, vaccination_status, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP())`,
                [profile.dogId, profile.type, profile.vaccinationStatus]
            );

            const metricsRows = await executeSnowflakeQuery(
                `SELECT 
                    (COUNT(CASE WHEN vaccination_status LIKE '%Up-to-Date%' OR vaccination_status LIKE '%Vaccinated%' THEN 1 END) * 100.0) / COUNT(*) AS immunity_ratio 
                 FROM dog_scans`
            );
            if (metricsRows && metricsRows.length > 0 && metricsRows[0].IMMUNITY_RATIO) {
                herdImmunityScore = `${Number(metricsRows[0].IMMUNITY_RATIO).toFixed(1)}% (Calculated via Snowflake Analytics)`;
            }
        } catch (snowflakeErr) {
            console.log("Snowflake notice (using mock analytics fallback):", snowflakeErr.message);
        }

        res.json({
            success: true,
            analysis,
            profile,
            solanaTx: solanaTxSignature,
            herdImmunityScore
        });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`PawID & Care server running on port ${PORT}`);
});