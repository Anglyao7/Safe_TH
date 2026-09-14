import { Hono } from 'hono';

type Bindings = {
  ASSETS?: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// ============================================================================
// 1. 服务端内存数据存储 (在 Worker 实例周期内保持，配合本地开发与测试)
// ============================================================================
interface User {
  id: string;
  username: string; // 纯数字账号
  password: string; // 纯数字密码
  name: string;
  avatar: string;
  phone: string;
}

interface TeamMemberLocation {
  userId: string;
  username: string;
  name: string;
  avatar: string;
  phone: string;
  lat: number;
  lng: number;
  accuracy: number;
  status: 'normal' | 'sos';
  updatedAt: number;
}

interface StoredImage {
  id: string;
  data: Uint8Array;
  mimeType: string;
  filename: string;
}

interface UserTrackingLocation extends TeamMemberLocation {
  teamCode?: string;
}

const users = new Map<string, User>();
const sessions = new Map<string, string>(); // token -> username
const teamLocations = new Map<string, Map<string, TeamMemberLocation>>(); // teamCode -> (userId -> loc)
const userLatestLocations = new Map<string, UserTrackingLocation>(); // identifier -> latest location
const storedImages = new Map<string, StoredImage>();

// 预设种子演示数据：默认小队 666888 内置一位同行向导队友，进入小队立即可见！
users.set('888888', {
  id: 'user_888888',
  username: '888888',
  password: '123',
  name: '阿泰 (曼谷向导)',
  avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  phone: '+66 81 234 5678',
});

const defaultGuideLoc: UserTrackingLocation = {
  userId: 'user_888888',
  username: '888888',
  name: '阿泰 (曼谷向导)',
  avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  phone: '+66 81 234 5678',
  lat: 13.7545,
  lng: 100.5065,
  accuracy: 15,
  status: 'normal',
  updatedAt: Date.now(),
  teamCode: '666888',
};

const defaultTeamMap = new Map<string, TeamMemberLocation>();
defaultTeamMap.set('user_888888', defaultGuideLoc);
teamLocations.set('666888', defaultTeamMap);
userLatestLocations.set('888888', defaultGuideLoc);
userLatestLocations.set('user_888888', defaultGuideLoc);

// ============================================================================
// 2. 存活探针与应急官方电话接口
// ============================================================================
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: '护途 · 泰国行程安全中心 (HuTu Console)',
    timestamp: new Date().toISOString(),
    region: 'Cloudflare Edge',
    features: {
      emergencySos: true,
      geoTracking: true,
      teamLiveRadar: true,
      imageUpload: true,
      auth: 'minimal_numeric',
    },
  });
});

app.get('/api/emergency-contacts', (c) => {
  return c.json([
    {
      id: 'police',
      name: '泰国报警 (Police Emergency)',
      number: '191',
      description: '泰国国家警察总署紧急报案热线',
      tag: '立即',
      category: 'emergency',
    },
    {
      id: 'tourist-police',
      name: '旅游警察 (Tourist Police)',
      number: '1155',
      description: '提供英语与中文报警与协助服务',
      tag: '推荐',
      category: 'tourist',
    },
    {
      id: 'embassy',
      name: '中国驻泰使馆领保',
      number: '+66 2 245 7010',
      description: '中国驻泰王国大使馆领事保护与协助',
      tag: '领保',
      category: 'consular',
    },
    {
      id: 'medical',
      name: '泰国急救中心',
      number: '1669',
      description: '国家医疗急救救援指挥中心',
      tag: '急救',
      category: 'medical',
    },
  ]);
});

// ============================================================================
// 3. 极简纯数字账号注册与登录
// ============================================================================
app.post('/api/auth/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();
  const name = String(body.name || '').trim() || `旅行者${username.slice(-4)}`;
  const phone = String(body.phone || '').trim();

  // 校验账号与简易密码（支持纯数字、字母或任意组合）
  if (!username || username.length < 2) {
    return c.json({ success: false, message: '账号长度至少需2位（支持纯数字、字母或任意组合）' }, 400);
  }
  if (!password || password.length < 3) {
    return c.json({ success: false, message: '密码至少需3位字符（支持纯数字、字母或任意组合）' }, 400);
  }

  if (users.has(username)) {
    return c.json({ success: false, message: '该账号已被注册，可直接登录' }, 400);
  }

  const user: User = {
    id: `user_${username}`,
    username,
    password,
    name,
    avatar: body.avatar || '',
    phone: phone || username,
  };

  users.set(username, user);
  const token = `token_${username}_${Date.now()}`;
  sessions.set(token, username);

  return c.json({
    success: true,
    message: '注册并登录成功',
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      phone: user.phone,
    },
  });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();

  if (!username || !password) {
    return c.json({ success: false, message: '请输入账号和密码（支持纯数字、字母或组合）' }, 400);
  }

  // 若账号不存在，提供极简友好体验：自动免阻力注册并登录！
  let user = users.get(username);
  if (!user) {
    user = {
      id: `user_${username}`,
      username,
      password,
      name: body.name || `行者${username.slice(-4)}`,
      avatar: '',
      phone: username,
    };
    users.set(username, user);
  } else if (user.password !== password) {
    return c.json({ success: false, message: '密码不匹配，请核对后重试' }, 401);
  }

  const token = `token_${username}_${Date.now()}`;
  sessions.set(token, username);

  return c.json({
    success: true,
    message: '登录成功',
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      phone: user.phone,
    },
  });
});

app.get('/api/auth/me', (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const username = sessions.get(token);

  if (!username || !users.has(username)) {
    return c.json({ loggedIn: false }, 401);
  }

  const user = users.get(username)!;
  return c.json({
    loggedIn: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      phone: user.phone,
    },
  });
});

// ============================================================================
// 4. 多人小队实时位置共享与雷达接口
// ============================================================================
app.post('/api/team/location', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const teamCode = String(body.teamCode || '666888').trim();
  const userId = String(body.userId || 'guest').trim();
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (isNaN(lat) || isNaN(lng)) {
    return c.json({ success: false, message: '坐标无效' }, 400);
  }

  let team = teamLocations.get(teamCode);
  if (!team) {
    team = new Map();
    teamLocations.set(teamCode, team);
  }

  const memberLoc: TeamMemberLocation = {
    userId,
    username: body.username || userId,
    name: body.name || `队友 ${userId.slice(-4)}`,
    avatar: body.avatar || '',
    phone: body.phone || '',
    lat,
    lng,
    accuracy: Number(body.accuracy) || 20,
    status: body.status === 'sos' ? 'sos' : 'normal',
    updatedAt: Date.now(),
  };

  team.set(userId, memberLoc);

  const trackingData: UserTrackingLocation = {
    ...memberLoc,
    teamCode,
  };
  userLatestLocations.set(memberLoc.username, trackingData);
  userLatestLocations.set(memberLoc.userId, trackingData);

  return c.json({
    success: true,
    teamCode,
    activeCount: team.size,
  });
});

// ============================================================================
// 4.1 单人专属实时位置动态追踪接口 (公开只读，供外部/亲友实时查看最新位置)
// ============================================================================
app.get('/api/track/:identifier', (c) => {
  const identifier = String(c.req.param('identifier') || '').trim();
  return handleTrackingLookup(c, identifier);
});

app.get('/api/track', (c) => {
  const identifier = String(c.req.query('username') || c.req.query('user') || '').trim();
  return handleTrackingLookup(c, identifier);
});

function handleTrackingLookup(c: any, identifier: string) {
  if (!identifier) {
    return c.json({ success: false, message: '请提供待追踪的用户名或用户ID' }, 400);
  }

  let loc = userLatestLocations.get(identifier);

  if (!loc) {
    for (const [tCode, teamMap] of teamLocations.entries()) {
      for (const [uid, member] of teamMap.entries()) {
        if (member.username === identifier || member.userId === identifier || uid === identifier) {
          loc = { ...member, teamCode: tCode };
          break;
        }
      }
      if (loc) break;
    }
  }

  if (!loc) {
    return c.json({
      success: false,
      message: `未找到用户【${identifier}】的实时定位数据，该用户可能尚未开启定位上报或已离线`,
      user: null,
    }, 404);
  }

  const now = Date.now();
  if (loc.username === '888888') {
    loc.updatedAt = now;
  }

  const secondsAgo = Math.max(0, Math.round((now - loc.updatedAt) / 1000));
  let timeAgoText = '刚刚';
  if (secondsAgo < 60) {
    timeAgoText = `${secondsAgo}秒前`;
  } else if (secondsAgo < 3600) {
    timeAgoText = `${Math.floor(secondsAgo / 60)}分钟前`;
  } else {
    timeAgoText = `${Math.floor(secondsAgo / 3600)}小时前`;
  }

  return c.json({
    success: true,
    user: {
      userId: loc.userId,
      username: loc.username,
      name: loc.name,
      avatar: loc.avatar,
      phone: loc.phone,
      lat: loc.lat,
      lng: loc.lng,
      accuracy: loc.accuracy,
      status: loc.status,
      teamCode: loc.teamCode || '666888',
      updatedAt: loc.updatedAt,
      timeAgo: timeAgoText,
      isOnline: secondsAgo < 20 * 60,
    },
  });
}

app.get('/api/team/members', (c) => {
  const teamCode = String(c.req.query('teamCode') || '666888').trim();
  const team = teamLocations.get(teamCode);

  if (!team) {
    return c.json({
      teamCode,
      members: [],
    });
  }

  // 过滤掉超过 20 分钟未更新心跳的离线用户（保留种子向导）
  const now = Date.now();
  const memberList: TeamMemberLocation[] = [];

  for (const [uid, loc] of team.entries()) {
    if (uid === 'user_888888') {
      loc.updatedAt = now; // 保持向导在线
    }
    if (now - loc.updatedAt < 20 * 60 * 1000) {
      memberList.push(loc);
    }
  }

  return c.json({
    teamCode,
    activeCount: memberList.length,
    members: memberList,
  });
});

// ============================================================================
// 5. 图片上传服务 (接收 multipart/form-data，支持头像与现场求助照片)
// ============================================================================
app.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return c.json({ success: false, message: '未检测到有效的图片文件' }, 400);
    }

    const fileBlob = file as File;
    const arrayBuffer = await fileBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // 生成唯一图片ID与访问URL
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const mimeType = fileBlob.type || 'image/jpeg';
    const filename = fileBlob.name || `${imageId}.jpg`;

    storedImages.set(imageId, {
      id: imageId,
      data: uint8Array,
      mimeType,
      filename,
    });

    return c.json({
      success: true,
      message: '图片上传成功',
      id: imageId,
      url: `/api/images/${imageId}`,
      filename,
      size: uint8Array.length,
    });
  } catch (err: any) {
    console.error('上传解析失败:', err);
    return c.json({ success: false, message: `上传失败: ${err.message}` }, 500);
  }
});

app.get('/api/images/:id', (c) => {
  const id = c.req.param('id');
  const img = storedImages.get(id);

  if (!img) {
    return c.text('Image Not Found', 404);
  }

  return new Response(img.data, {
    status: 200,
    headers: {
      'Content-Type': img.mimeType,
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': `inline; filename="${img.filename}"`,
    },
  });
});

// ============================================================================
// 6. 兜底静态资源托管 (Cloudflare Workers Static Assets)
// ============================================================================
app.notFound(async (c) => {
  if (c.env?.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default app;
