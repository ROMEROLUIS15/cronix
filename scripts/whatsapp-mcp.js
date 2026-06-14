const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 1. Leer las credenciales de Meta desde .env.local de forma manual
const envPath = path.join(__dirname, '..', '.env.local');
let token = '';
let bizAccountId = '';
let phoneId = '';

try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const match = line.trim().match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      if (key === 'WHATSAPP_ACCESS_TOKEN') {
        token = val;
      } else if (key === 'WHATSAPP_BUSINESS_ACCOUNT_ID') {
        bizAccountId = val;
      } else if (key === 'WHATSAPP_PHONE_NUMBER_ID') {
        phoneId = val;
      }
    }
  });
} catch (e) {
  // Fallback
}

token = token || process.env.WHATSAPP_ACCESS_TOKEN;
bizAccountId = bizAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
phoneId = phoneId || process.env.WHATSAPP_PHONE_NUMBER_ID;

// 2. Lector de la interfaz stdio (JSON-RPC)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    if (response) {
      console.log(JSON.stringify(response));
    }
  } catch (err) {
    console.error("Error procesando línea:", err.message);
  }
});

// 3. Router de peticiones del protocolo MCP
async function handleRequest(req) {
  const { method, params, id } = req;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: 'whatsapp-cloud-mcp',
          version: '1.0.0'
        }
      }
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'create_whatsapp_template',
            description: 'Crea una nueva plantilla de mensaje de WhatsApp (UTILITY o MARKETING) en el Business Manager de Meta.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Nombre único de la plantilla en minúsculas y con guiones bajos (ej: confirmacion_cita_v1).'
                },
                category: {
                  type: 'string',
                  description: 'Categoría de la plantilla: UTILITY o MARKETING. Las alertas de servicio deben ser UTILITY.'
                },
                language: {
                  type: 'string',
                  description: 'Código de idioma de la plantilla. Por defecto es "es" (Español).'
                },
                body_text: {
                  type: 'string',
                  description: 'El texto del cuerpo del mensaje. Usa {{1}}, {{2}} para variables. Ej: "Hola {{1}}, tu cita es el {{2}}."'
                },
                header_text: {
                  type: 'string',
                  description: 'Texto de cabecera opcional para el mensaje.'
                },
                footer_text: {
                  type: 'string',
                  description: 'Texto de pie de página opcional en fuente pequeña.'
                }
              },
              required: ['name', 'category', 'body_text']
            }
          },
          {
            name: 'send_whatsapp_template_message',
            description: 'Envía un mensaje usando una plantilla pre-aprobada a un número de teléfono de paciente.',
            inputSchema: {
              type: 'object',
              properties: {
                to: {
                  type: 'string',
                  description: 'Número del destinatario con código de país, sin el signo + (ej: 584141234567).'
                },
                template_name: {
                  type: 'string',
                  description: 'El nombre exacto de la plantilla aprobada en Meta.'
                },
                language: {
                  type: 'string',
                  description: 'Código de idioma, por defecto "es".'
                },
                parameters: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Lista de valores en texto para reemplazar {{1}}, {{2}}, etc. en orden.'
                }
              },
              required: ['to', 'template_name', 'parameters']
            }
          }
        ]
      }
    };
  }

  // Responder con éxito (vacío) a solicitudes estándar de recursos y prompts para evitar timeouts
  if (method === 'resources/list' || method === 'resources/templates/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { resources: [] }
    };
  }

  if (method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { prompts: [] }
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      if (name === 'create_whatsapp_template') {
        const result = await createTemplate(args);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          }
        };
      }
      if (name === 'send_whatsapp_template_message') {
        const result = await sendTemplateMessage(args);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          }
        };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: err.message
        }
      };
    }
  }

  // Si la petición espera una respuesta (tiene id), responder con Method not found
  if (id !== undefined) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    };
  }

  return null;
}

// 4. Implementación de llamadas a la API Graph de Meta
async function createTemplate({ name, category, language = 'es', body_text, header_text, footer_text }) {
  if (!bizAccountId || !token) {
    throw new Error("Credenciales faltantes en .env.local: WHATSAPP_BUSINESS_ACCOUNT_ID o WHATSAPP_ACCESS_TOKEN");
  }

  const components = [];
  
  if (header_text) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: header_text
    });
  }

  components.push({
    type: 'BODY',
    text: body_text
  });

  if (footer_text) {
    components.push({
      type: 'FOOTER',
      text: footer_text
    });
  }

  const payload = {
    name,
    category,
    language,
    components
  };

  const url = `https://graph.facebook.com/v19.0/${bizAccountId}/message_templates`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error de Meta API: ${JSON.stringify(data)}`);
  }
  return data;
}

async function sendTemplateMessage({ to, template_name, language = 'es', parameters }) {
  if (!phoneId || !token) {
    throw new Error("Credenciales faltantes en .env.local: WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_ACCESS_TOKEN");
  }

  const parameterObjects = parameters.map(p => ({
    type: 'text',
    text: p
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template_name,
      language: {
        code: language
      },
      components: [
        {
          type: 'body',
          parameters: parameterObjects
        }
      ]
    }
  };

  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error de Meta API: ${JSON.stringify(data)}`);
  }
  return data;
}
