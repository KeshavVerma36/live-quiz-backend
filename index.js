const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 3001;

// Middleware
app.use(cors({
    origin: 'https://live-quiz-frontend.vercel.app',
    credentials: true,
}));
app.use(express.json());

const genAI = new GoogleGenerativeAI('AIzaSyD1AU87CK2mGIESkDx5fHZ_HsyEYgfkFrs');

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

let cachedQuizQuestions = null; // This will store the fetched questions
let playersScores = {}; // Store scores of all players

async function generateQuizQuestions() {
    try {
        const prompt = `
            Generate 10 multiple-choice quiz questions about World History.
            Each question should have 4 options, and the correct answer should be labeled.
            The format should be:
            Question: <question>
            A) <option 1>
            B) <option 2>
            C) <option 3>
            D) <option 4>
            Correct: <correct option letter>
        `;

        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        console.log("Sending prompt to AI...");
        const result = await model.generateContent([prompt]);
        console.log("Received response from AI.");

        if (result && result.response) {
            console.log("Full AI Response:\n", result.response.text());
        } else {
            console.error("Unexpected response structure:", result);
        }

        const questions = result.response.text().split('\n').map(line => line.trim()).filter(line => line);

        const quizQuestions = [];
        for (let i = 0; i < questions.length; i++) {
            const questionMatch = questions[i].match(/Question:\s*(.*)/);
            const optionAMatch = questions[i + 1]?.match(/A\)\s*(.*)/);
            const optionBMatch = questions[i + 2]?.match(/B\)\s*(.*)/);
            const optionCMatch = questions[i + 3]?.match(/C\)\s*(.*)/);
            const optionDMatch = questions[i + 4]?.match(/D\)\s*(.*)/);
            const correctMatch = questions[i + 5]?.match(/Correct:\s*(\w)/);

            if (questionMatch && optionAMatch && optionBMatch && optionCMatch && optionDMatch && correctMatch) {
                const options = [
                    optionAMatch[1].trim(),
                    optionBMatch[1].trim(),
                    optionCMatch[1].trim(),
                    optionDMatch[1].trim(),
                ];

                const correctAnswerIndex = ['A', 'B', 'C', 'D'].indexOf(correctMatch[1].trim());
                const correctAnswer = correctAnswerIndex >= 0 ? options[correctAnswerIndex] : 'No correct answer provided';

                quizQuestions.push({
                    question: questionMatch[1].trim(),
                    correct: correctAnswer,
                    options,
                });

                i += 5; // Skip to the next question block
            } else {
                console.error(`Could not parse question at index ${i}`);
            }
        }

        console.log('Parsed Quiz Questions:', quizQuestions);

        if (quizQuestions.length === 0) {
            throw new Error('No valid quiz questions generated.');
        }

        return quizQuestions;
    } catch (error) {
        console.error('Error generating quiz questions:', error.message || error);
        return [];
    }
}

// Fetch quiz questions once when the server starts
const fetchHistoryQuestions = async () => {
    if (!cachedQuizQuestions) {
        console.log("Fetching questions from AI for the first time...");
        cachedQuizQuestions = await generateQuizQuestions();
    } else {
        console.log("Using cached quiz questions...");
    }
    return cachedQuizQuestions;
};

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    if (req.headers.origin === 'https://live-quiz-frontend.vercel.app') {
        console.log('A new player connected');

        ws.on('message', async (message) => {
            const { type, username } = JSON.parse(message);

            if (type === 'GET_QUESTIONS') {
                const questions = await fetchHistoryQuestions(); // Fetch or return cached questions
                ws.send(JSON.stringify({ type: 'QUESTIONS', payload: questions }));
            } else if (type === 'UPDATE_SCORE') {
                const { score } = JSON.parse(message);
                playersScores[username] = score; // Update score for the player

                // Broadcast updated scores to all connected clients
                const players = Object.entries(players Scores).map(([name, score]) => ({ username: name, score }));
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN ) {
                        client.send(JSON.stringify({ type: 'UPDATE_SCORES', players }));
                    }
                });

                // Log the updated scores
                console.log('Updated Scores:', players);
            } else if (type === 'START_QUIZ') {
                console.log('Received START_QUIZ signal from Host page...');

                // Broadcast START_QUIZ message to all connected clients
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'START_QUIZ' }));
                    }
                });
            }
        });

        ws.on('close', () => {
            console.log('A player disconnected');
            delete playersScores[ws.username]; // Remove player score on disconnect
        });
    } else {
        ws.close();
    }
});

// Upgrade HTTP server to WebSocket
const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
