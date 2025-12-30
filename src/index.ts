import express from "express";
import cors from "cors";
import axios, { AxiosError } from "axios";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

// ----------------------------------------------------------------------
// 1. 유틸리티 함수
// ----------------------------------------------------------------------
function calculateHeatRisk(temp: number, humidity: number) {
  const feelsLike = temp + (0.55 - 0.0055 * humidity) * (temp - 14.5);
  if (feelsLike >= 38) return { level: "🚨 위험", desc: "매우 위험합니다." };
  if (feelsLike >= 35) return { level: "⚠️ 경고", desc: "위험할 수 있습니다." };
  if (feelsLike >= 31) return { level: "⚡ 주의", desc: "조심해야 합니다." };
  return { level: "✅ 관심", desc: "괜찮습니다." };
}

/**
 * 위치 이름을 위도/경도로 변환하는 함수 (타임아웃 및 재시도 포함)
 * @param location 위치 이름 (예: '서울시 종로구')
 * @returns { lat: number, lon: number, displayName: string } 또는 null
 */
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
    // 401 에러는 상위로 전파
    if (error.message?.includes("인증")) {
      throw error;
    }
    console.error("Geocoding error:", error.message);
    return null;
  }
}

/**
 * 외부 API 호출을 위한 안전한 axios 래퍼 (타임아웃 및 재시도 포함)
 */
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
      
      // 타임아웃이나 네트워크 에러인 경우 재시도
      if (attempt < maxRetries && (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ENOTFOUND' || !axiosError.response)) {
        console.warn(`API 호출 실패 (시도 ${attempt}/${maxRetries}), 재시도 중...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      
      throw error;
    }
  }
  
  throw new Error("API 호출에 실패했습니다. 서버가 응답하지 않습니다.");
}

// ----------------------------------------------------------------------
// 2. MCP Server 설정
// ----------------------------------------------------------------------
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
    // 위치 이름을 위도/경도로 변환하는 툴
    if (name === "geocode_location") {
      const location = args?.location as string;
      if (!location) {
        throw new Error("위치 이름이 필요합니다.");
      }

      // OpenStreetMap Nominatim API 사용 (무료, API 키 불필요)
      const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1&countrycodes=kr`;
      const response = await axios.get(geocodeUrl, {
        headers: {
          "User-Agent": "SilverCare-MCP/1.0", // Nominatim은 User-Agent 필수
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
      const lat = parseFloat(result.lat);
      const lon = parseFloat(result.lon);
      const displayName = result.display_name;

      return {
        content: [
          {
            type: "text",
            text: `📍 위치 정보\n\n**위치**: ${displayName}\n**위도**: ${lat}\n**경도**: ${lon}\n\n이제 이 위도/경도를 사용하여 날씨 분석이나 쉼터 찾기 툴을 호출할 수 있습니다.`,
          },
        ],
      };
    }

    // 위치 정보 가져오기 (location 텍스트 또는 lat/lon)
    let lat: number;
    let lon: number;
    let locationName: string | undefined;

    if (args?.location) {
      // 위치 텍스트가 제공된 경우 geocoding 수행
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
      // 위도/경도가 직접 제공된 경우
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
      // 실제 기상 API 호출 (타임아웃 및 재시도 포함)
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,uv_index&timezone=Asia%2FSeoul`;
      
      let data: any;
      try {
        const response = await safeApiCall<any>(weatherUrl, { timeout: 10000, maxRetries: 3 });
        data = response.current;
      } catch (error: any) {
        // 401 에러인 경우 명시적으로 처리
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
      // 위도/경도에 따라 다른 쉼터 반환 (간단한 지역별 분류)
      let shelters: Array<{ name: string; dist: string; type: string; lat: number; lon: number }> = [];
      
      // 서울 지역 (위도 37.4~37.7, 경도 126.9~127.1)
      if (lat >= 37.4 && lat <= 37.7 && lon >= 126.9 && lon <= 127.1) {
        shelters = [
          { name: "종로3가 경로당", dist: "120m", type: "무더위쉼터", lat: lat + 0.001, lon: lon + 0.001 },
          { name: "탑골공원 관리사무소", dist: "350m", type: "공공시설", lat: lat - 0.001, lon: lon - 0.001 },
        ];
      }
      // 부산 지역 (위도 35.0~35.3, 경도 129.0~129.2)
      else if (lat >= 35.0 && lat <= 35.3 && lon >= 129.0 && lon <= 129.2) {
        shelters = [
          { name: "해운대 주민센터", dist: "200m", type: "무더위쉼터", lat: lat + 0.001, lon: lon + 0.001 },
          { name: "광안리 해수욕장 관리사무소", dist: "450m", type: "공공시설", lat: lat - 0.001, lon: lon - 0.001 },
        ];
      }
      // 제주 지역 (위도 33.4~33.6, 경도 126.4~126.6)
      else if (lat >= 33.4 && lat <= 33.6 && lon >= 126.4 && lon <= 126.6) {
        shelters = [
          { name: "제주시청", dist: "180m", type: "무더위쉼터", lat: lat + 0.001, lon: lon + 0.001 },
          { name: "제주도청", dist: "320m", type: "공공시설", lat: lat - 0.001, lon: lon - 0.001 },
        ];
      }
      // 기타 지역 (기본값)
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
    // 401 인증 에러인 경우 명시적으로 처리
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
    
    // 네트워크 타임아웃 또는 서버 응답 없음
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
    
    // 일반 에러
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

// ----------------------------------------------------------------------
// 3. Express 서버 (Streamable HTTP - Stateless 모드)
// ----------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json()); // JSON body 파싱

// 인증 토큰 검증 미들웨어 (환경변수로 활성화 가능)
const API_KEY = process.env.MCP_API_KEY; // 선택적 API 키

function authenticateRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
  // API 키가 설정되지 않은 경우 인증 건너뛰기
  if (!API_KEY) {
    return next();
  }

  // Authorization 헤더 또는 쿼리 파라미터에서 API 키 확인
  const authHeader = req.headers.authorization;
  const apiKeyFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const apiKeyFromQuery = req.query.apiKey as string | undefined;
  const providedKey = apiKeyFromHeader || apiKeyFromQuery;

  if (!providedKey || providedKey !== API_KEY) {
    console.warn(`❌ [Auth] 인증 실패: ${req.url}`);
    return res.status(401).json({
      error: "Unauthorized",
      message: "인증이 필요하거나 인증 정보가 만료되었습니다. 유효한 API 키를 제공해주세요.",
    });
  }

  next();
}

// 로그 미들웨어
app.use((req, res, next) => {
  console.log(`📡 [${req.method}] 요청 받음: ${req.url}`);
  next();
});

// Stateless Streamable HTTP Transport 생성 (세션 ID 없음)
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless 모드
});

// MCP 서버에 transport 연결 (비동기 초기화)
server.connect(transport).catch((error) => {
  console.error("❌ [Error] MCP 서버 연결 실패:", error);
  process.exit(1);
});

// MCP 엔드포인트 핸들러 (POST, GET, DELETE 지원)
const mcpHandler = async (req: express.Request, res: express.Response) => {
  try {
    // 인증 미들웨어 적용
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

    // Streamable HTTP transport로 요청 처리
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error(`❌ [Error] MCP 엔드포인트 에러:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: error.message || "서버에서 오류가 발생했습니다.",
      });
    }
  }
};

// MCP 엔드포인트 설정 (POST, GET, DELETE 모두 지원)
app.post("/mcp", mcpHandler);
app.get("/mcp", mcpHandler);
app.delete("/mcp", mcpHandler);

// 전역 에러 핸들러
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`❌ [Global Error] ${err.message}`);
  
  // 401 인증 에러
  if (err.status === 401 || err.message?.includes("인증")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "인증이 필요하거나 인증 정보가 만료되었습니다.",
    });
  }
  
  // 500 서버 에러
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal Server Error",
      message: "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`✅ [SERVER] Streamable HTTP MCP Server running on http://localhost:${PORT}`);
  console.log(`📡 [ENDPOINT] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`🔄 [MODE] Stateless mode (no session management)`);
  if (API_KEY) {
    console.log(`🔐 [AUTH] API 키 인증이 활성화되어 있습니다.`);
  } else {
    console.log(`ℹ️ [AUTH] API 키 인증이 비활성화되어 있습니다. (MCP_API_KEY 환경변수 설정 시 활성화)`);
  }
});