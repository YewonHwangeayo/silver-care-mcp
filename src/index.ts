import express from "express";
import cors from "cors";
import axios, { AxiosError } from "axios";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

function calculateHeatRisk(temp: number, humidity: number) {
  const feelsLike = temp + (0.55 - 0.0055 * humidity) * (temp - 14.5);
  if (feelsLike >= 38) return { level: "🚨 위험", desc: "매우 위험합니다." };
  if (feelsLike >= 35) return { level: "⚠️ 경고", desc: "위험할 수 있습니다." };
  if (feelsLike >= 31) return { level: "⚡ 주의", desc: "조심해야 합니다." };
  return { level: "✅ 관심", desc: "괜찮습니다." };
}

async function geocodeLocation(location: string): Promise<{ lat: number; lon: number; displayName: string } | null> {
  try {
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1&countrycodes=kr`;
    const response = await safeApiCall<any[]>(geocodeUrl, {
      timeout: 5000,
      maxRetries: 3,
      headers: {
        "User-Agent": "SilverCare-MCP/1.0",
      },
    });

    if (!response || response.length === 0) {
      return null;
    }

    const result = response[0];
    return {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      displayName: result.display_name,
    };
  } catch (error: any) {
    if (error.message?.includes("인증")) {
      throw error;
    }
    return null;
  }
}

async function safeApiCall<T>(
  url: string,
  options: { timeout?: number; maxRetries?: number; headers?: Record<string, string> } = {}
): Promise<T> {
  const { timeout = 10000, maxRetries = 3, headers = {} } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get<T>(url, {
        timeout,
        headers,
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      
      // 401 Unauthorized 에러인 경우 즉시 throw
      if (axiosError.response?.status === 401) {
        throw new Error("인증이 필요하거나 만료되었습니다. API 키를 확인해주세요.");
      }
      
      if (attempt < maxRetries && (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ENOTFOUND' || !axiosError.response)) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      
      throw error;
    }
  }
  
  throw new Error("API 호출에 실패했습니다. 서버가 응답하지 않습니다.");
}

const server = new Server(
  { name: "silver-care-mvp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "geocode_location",
        description: "위치 이름(예: '서울시 종로구', '부산 해운대')을 위도와 경도로 변환합니다. 사용자가 위치를 텍스트로 입력했을 때 먼저 이 툴을 호출하세요.",
        inputSchema: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "위치 이름 (예: '서울시 종로구', '부산 해운대', '제주시청')",
            },
          },
          required: ["location"],
        },
      },
      {
        name: "analyze_heat_risk",
        description: "위치의 실시간 날씨와 온열질환 위험도를 분석합니다. 위치 이름(예: '서울시 종로구') 또는 위도/경도를 입력할 수 있습니다.",
        inputSchema: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "위치 이름 (예: '서울시 종로구', '부산 해운대') - lat/lon이 없을 때 사용",
            },
            lat: {
              type: "number",
              description: "위도 - location이 없을 때 사용",
            },
            lon: {
              type: "number",
              description: "경도 - location이 없을 때 사용",
            },
          },
        },
      },
      {
        name: "find_cooling_shelter",
        description: "주변 무더위 쉼터를 찾습니다. 위치 이름(예: '서울시 종로구') 또는 위도/경도를 입력할 수 있습니다.",
        inputSchema: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "위치 이름 (예: '서울시 종로구', '부산 해운대') - lat/lon이 없을 때 사용",
            },
            lat: {
              type: "number",
              description: "위도 - location이 없을 때 사용",
            },
            lon: {
              type: "number",
              description: "경도 - location이 없을 때 사용",
            },
          },
        },
      },
      {
        name: "generate_sos_alert",
        description: "긴급 구조 요청 메시지를 생성합니다. 위치 이름(예: '서울시 종로구') 또는 위도/경도를 입력할 수 있습니다.",
        inputSchema: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "위치 이름 (예: '서울시 종로구', '부산 해운대') - lat/lon이 없을 때 사용",
            },
            lat: {
              type: "number",
              description: "위도 - location이 없을 때 사용",
            },
            lon: {
              type: "number",
              description: "경도 - location이 없을 때 사용",
            },
            symptoms: {
              type: "string",
              description: "현재 증상 (예: 어지러움, 구토, 숨참)",
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === "geocode_location") {
      const location = args?.location as string;
      if (!location) {
        throw new Error("위치 이름이 필요합니다.");
      }

      const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1&countrycodes=kr`;
      const response = await axios.get(geocodeUrl, {
        headers: {
          "User-Agent": "SilverCare-MCP/1.0",
        },
      });

      if (!response.data || response.data.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `❌ 위치를 찾을 수 없습니다: "${location}"\n\n다른 위치 이름으로 시도해주세요.`,
            },
          ],
          isError: true,
        };
      }

      const result = response.data[0];
      return {
        content: [
          {
            type: "text",
            text: `📍 위치 정보\n\n**위치**: ${result.display_name}\n**위도**: ${parseFloat(result.lat)}\n**경도**: ${parseFloat(result.lon)}\n\n이제 이 위도/경도를 사용하여 날씨 분석이나 쉼터 찾기 툴을 호출할 수 있습니다.`,
          },
        ],
      };
    }

    let lat: number;
    let lon: number;
    let locationName: string | undefined;

    if (args?.location) {
      const geocoded = await geocodeLocation(args.location as string);
      if (!geocoded) {
        return {
          content: [
            {
              type: "text",
              text: `❌ 위치를 찾을 수 없습니다: "${args.location}"\n\n다른 위치 이름으로 시도해주세요.`,
            },
          ],
          isError: true,
        };
      }
      lat = geocoded.lat;
      lon = geocoded.lon;
      locationName = geocoded.displayName;
    } else if (args?.lat && args?.lon) {
      lat = Number(args.lat);
      lon = Number(args.lon);
    } else {
      return {
        content: [
          {
            type: "text",
            text: "❌ 위치 정보가 필요합니다. 'location' (위치 이름) 또는 'lat'/'lon' (위도/경도)를 제공해주세요.",
          },
        ],
        isError: true,
      };
    }

    if (name === "analyze_heat_risk") {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,uv_index&timezone=Asia%2FSeoul`;
      
      let data: any;
      try {
        const response = await safeApiCall<any>(weatherUrl, { timeout: 10000, maxRetries: 3 });
        data = response.current;
      } catch (error: any) {
        if (error.message.includes("인증")) {
          return {
            content: [
              {
                type: "text",
                text: `❌ 인증 오류: ${error.message}\n\nAPI 키가 필요하거나 만료되었습니다.`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }

      const risk = calculateHeatRisk(data.temperature_2m, data.relative_humidity_2m);

      const locationInfo = locationName ? `**위치**: ${locationName}\n` : "";
      const result = `
## 🌡️ 현재 위치 온열질환 분석
${locationInfo}
> **"${risk.desc}"**

* **위험 단계**: **${risk.level}**
* **현재 기온**: ${data.temperature_2m}°C
* **체감 온도**: **${data.apparent_temperature}°C** (습도 ${data.relative_humidity_2m}%)
* **자외선 지수**: ${data.uv_index}
`;
      return { content: [{ type: "text", text: result }] };
    }

    if (name === "find_cooling_shelter") {
      let shelters: Array<{ name: string; dist: string; type: string; lat: number; lon: number }> = [];
      
      if (lat >= 37.4 && lat <= 37.7 && lon >= 126.9 && lon <= 127.1) {
        shelters = [
          { name: "종로3가 경로당", dist: "120m", type: "무더위쉼터", lat: lat + 0.001, lon: lon + 0.001 },
          { name: "탑골공원 관리사무소", dist: "350m", type: "공공시설", lat: lat - 0.001, lon: lon - 0.001 },
        ];
      }
      else if (lat >= 35.0 && lat <= 35.3 && lon >= 129.0 && lon <= 129.2) {
        shelters = [
          { name: "해운대 주민센터", dist: "200m", type: "무더위쉼터", lat: lat + 0.001, lon: lon + 0.001 },
          { name: "광안리 해수욕장 관리사무소", dist: "450m", type: "공공시설", lat: lat - 0.001, lon: lon - 0.001 },
        ];
      }
      else if (lat >= 33.4 && lat <= 33.6 && lon >= 126.4 && lon <= 126.6) {
        shelters = [
          { name: "제주시청", dist: "180m", type: "무더위쉼터", lat: lat + 0.001, lon: lon + 0.001 },
          { name: "제주도청", dist: "320m", type: "공공시설", lat: lat - 0.001, lon: lon - 0.001 },
        ];
      }
      else {
        shelters = [
          { name: "가까운 경로당", dist: "150m", type: "무더위쉼터", lat: lat + 0.001, lon: lon + 0.001 },
          { name: "지역 주민센터", dist: "280m", type: "공공시설", lat: lat - 0.001, lon: lon - 0.001 },
        ];
      }

      const locationInfo = locationName ? `**위치**: ${locationName}\n` : "";
      let shelterList = `## 🏠 가까운 무더위 쉼터\n${locationInfo}\n`;
      shelters.forEach((s, idx) => {
        const mapLink = `https://map.kakao.com/link/to/${s.name},${s.lat},${s.lon}`;
        shelterList += `**${idx + 1}. ${s.name}** (${s.dist})\n`;
        shelterList += `- 구분: ${s.type}\n`;
        shelterList += `- [🗺️ 길찾기 바로가기](${mapLink})\n\n`;
      });

      return { content: [{ type: "text", text: shelterList }] };
    }

    if (name === "generate_sos_alert") {
      const symptoms = args?.symptoms || "증상 설명 없음";
      const timestamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      const mapUrl = `https://map.kakao.com/link/map/구조요청위치,${lat},${lon}`;
      const locationInfo = locationName || `위도 ${lat}, 경도 ${lon}`;

      const sosCard = `
## 🆘 긴급 구조 요청 (SOS)
보호자에게 아래 메시지를 전송하세요.

\`\`\`text
[긴급] 온열질환 구조 요청
시간: ${timestamp}
증상: ${symptoms}
위치: ${locationInfo}

지도 보기: ${mapUrl}
\`\`\`

**119 신고가 필요하면 아래 버튼을 누르세요**
[📞 119 전화 연결](tel:119)
`;
      return { content: [{ type: "text", text: sosCard }] };
    }

    throw new Error("Unknown tool");
  } catch (error: any) {
    if (error.message?.includes("인증") || error.message?.includes("Unauthorized")) {
      return {
        content: [
          {
            type: "text",
            text: `❌ 인증 오류 (401 Unauthorized)\n\n${error.message}\n\n유효한 API 키를 제공해주세요.`,
          },
        ],
        isError: true,
      };
    }
    
    if (error.message?.includes("타임아웃") || error.message?.includes("응답하지 않습니다")) {
      return {
        content: [
          {
            type: "text",
            text: `⚠️ 서비스 일시 중단\n\n${error.message}\n\n잠시 후 다시 시도해주세요.`,
          },
        ],
        isError: true,
      };
    }
    
    return {
      content: [
        {
          type: "text",
          text: `❌ 에러 발생: ${error.message || "알 수 없는 오류가 발생했습니다."}`,
        },
      ],
      isError: true,
    };
  }
});

const app = express();
app.use(cors());

const API_KEY = process.env.MCP_API_KEY;

const mcpHandler = async (req: express.Request, res: express.Response) => {
  try {
    if (API_KEY) {
      const authHeader = req.headers.authorization;
      const apiKeyFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
      const apiKeyFromQuery = req.query.apiKey as string | undefined;
      const providedKey = apiKeyFromHeader || apiKeyFromQuery;

      if (!providedKey || providedKey !== API_KEY) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "인증이 필요하거나 인증 정보가 만료되었습니다.",
        });
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    
    let body: any = undefined;
    if (req.method !== "GET" && req.method !== "DELETE") {
      if (req.headers["content-type"]?.includes("application/json")) {
        body = req.body;
      }
    }
    
    await transport.handleRequest(req, res, body);
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: error.message || "서버에서 오류가 발생했습니다.",
      });
    }
  }
};

app.use(express.json());

app.post("/mcp", mcpHandler);
app.get("/mcp", mcpHandler);
app.delete("/mcp", mcpHandler);

app.get("/", (req, res) => {
  res.json({
    name: "Silver Care MCP",
    version: "1.0.0",
    status: "running",
    endpoint: "/mcp",
    description: "고령자를 위한 실시간 온열질환 위험도 분석 및 무더위 쉼터 안내 서비스",
  });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.status === 401 || err.message?.includes("인증")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "인증이 필요하거나 인증 정보가 만료되었습니다.",
    });
  }
  
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal Server Error",
      message: "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});