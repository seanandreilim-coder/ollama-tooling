import ollama from 'ollama';
import Database from 'better-sqlite3';

// Initialize a local SQLite database
const db = new Database('company.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  );
  
  INSERT OR IGNORE INTO users (name, role, email) VALUES 
  ('Alice Smith', 'Administrator', 'alice@company.com'),
  ('Bob Jones', 'Developer', 'bob@company.com'),
  ('Charlie Brown', 'Product Manager', 'charlie@company.com');
`);

// Define the tool implementation
function getUsers(): string {
    try {
        const stmt = db.prepare("SELECT * FROM users");
        const results = stmt.all();
        return JSON.stringify(results);
    } catch (error: any) {
        return JSON.stringify({ error: error.message });
    }
}

interface GetUserArgs {
  name: string;
}

function getUserFromDatabase(args: GetUserArgs): string {
    try {
        const stmt = db.prepare("SELECT * FROM users WHERE name LIKE ?");
        console.log(`getUserFromDatabase: ${args.name}`)
        // Use partial matching for flexibility
        const results = stmt.all(`%${args.name}%`);
        return JSON.stringify(results);
    } catch (error: any) {
        return JSON.stringify({ error: error.message });
    }
}

// Map function names to their implementations
const availableTools: Record<string, Function> = {
    get_users: getUsers,
    get_user_info: getUserFromDatabase,
};

// Define the tool schema for Ollama
const tools = [
    {
        type: 'function' as const,
        function: {
            name: 'get_users',
            description: 'Retrieves all user details (role, email) from the database.',
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_user_info',
            description: 'Retrieves user details (role, email) from the database given their name.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The full or partial name of the employee/user.',
                    },
                },
                required: ['name'],
            },
        },
    }
];

// Use a model that supports tool calling
//const model = 'qwen3.5:4b';
//const model = 'llama3.2:3b';
const model = 'gemma4:e2b';

async function runAgent(userPrompt: string) {
    const messages = [{ role: 'user', content: userPrompt }];

    // 1. Send the prompt and tool definition to Ollama
    const response = await ollama.chat({
        model: model,
        messages: messages,
        tools: tools,
    });

    messages.push(response.message);

    // 2. Check if the model wants to call a tool
    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        for (const toolCall of response.message.tool_calls) {
            const funcName = toolCall.function.name;
            const funcArgs = toolCall.function.arguments;

            console.log(`\nModel requested tool: ${funcName}`, funcArgs);

            const toolToRun = availableTools[funcName];
            if (toolToRun) {
                const toolResult = toolToRun(funcArgs);
                console.log(`Tool output: ${toolResult}`);

                // 3. Append the tool result back to the conversation
                messages.push({
                    role: 'tool',
                    content: toolResult,
                    // Note: some SDK versions or API formats link tool responses via name/tool_call_id
                } as any);
            }
        }

        // 4. Send the tool results back to the model for a final natural language answer
        const finalResponse = await ollama.chat({
            model: model,
            messages: messages,
        });

        console.log('\nFinal AI response:\n', finalResponse.message.content);
    } else {
        console.log('\nAI response:\n', response.message.content);
    }
}

runAgent('List all users from the database and their roles.');
runAgent("Can you check the database and find Sean's email address and role?");
