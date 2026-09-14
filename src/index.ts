import { Hono } from 'hono';

type Bindings = {
  ASSETS?: Fetcher;
  SAFETY_KV?: KVNamespace;
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

interface TeamRoom {
  code: string;
  ownerId: string;
  ownerName: string;
  createdAt: number;
  kickedUserIds: Set<string>;
  disbanded?: boolean;
}

const users = new Map<string, User>();
const sessions = new Map<string, string>(); // token -> username
const teamLocations = new Map<string, Map<string, TeamMemberLocation>>(); // teamCode -> (userId -> loc)
const teamRooms = new Map<string, TeamRoom>(); // teamCode -> TeamRoom
const userLatestLocations = new Map<string, UserTrackingLocation>(); // identifier -> latest location
const storedImages = new Map<string, StoredImage>();



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
// 2.5 全球持久化存储适配层：优先接入 Cloudflare KV，无 KV 绑定时优雅降级至内存 Map
// ============================================================================
async function findUser(c: any, username: string): Promise<User | null> {
  if (c.env?.SAFETY_KV) {
    try {
      const data = await c.env.SAFETY_KV.get(`user:${username}`);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('KV read user error:', e);
    }
  }
  return users.get(username) || null;
}

async function persistUser(c: any, user: User): Promise<void> {
  users.set(user.username, user);
  if (c.env?.SAFETY_KV) {
    try {
      await c.env.SAFETY_KV.put(`user:${user.username}`, JSON.stringify(user));
      await c.env.SAFETY_KV.put(`user_id:${user.id}`, JSON.stringify(user));
    } catch (e) {
      console.warn('KV put user error:', e);
    }
  }
}

async function findSession(c: any, token: string): Promise<string | null> {
  if (c.env?.SAFETY_KV) {
    try {
      const username = await c.env.SAFETY_KV.get(`session:${token}`);
      if (username) return username;
    } catch (e) {
      console.warn('KV read session error:', e);
    }
  }
  return sessions.get(token) || null;
}

async function persistSession(c: any, token: string, username: string): Promise<void> {
  sessions.set(token, username);
  if (c.env?.SAFETY_KV) {
    try {
      await c.env.SAFETY_KV.put(`session:${token}`, username, { expirationTtl: 86400 * 30 });
    } catch (e) {
      console.warn('KV put session error:', e);
    }
  }
}

async function removeSession(c: any, token: string): Promise<void> {
  sessions.delete(token);
  if (c.env?.SAFETY_KV) {
    try {
      await c.env.SAFETY_KV.delete(`session:${token}`);
    } catch (e) {}
  }
}

async function findRoom(c: any, teamCode: string): Promise<TeamRoom | null> {
  if (c.env?.SAFETY_KV) {
    try {
      const data = await c.env.SAFETY_KV.get(`room:${teamCode}`);
      if (data) {
        const parsed = JSON.parse(data);
        const room: TeamRoom = {
          code: parsed.code,
          ownerId: parsed.ownerId,
          ownerName: parsed.ownerName,
          createdAt: parsed.createdAt,
          kickedUserIds: new Set(parsed.kickedUserIds || []),
          disbanded: parsed.disbanded || false,
        };
        teamRooms.set(teamCode, room);
        return room;
      }
    } catch (e) {}
  }
  return teamRooms.get(teamCode) || null;
}

async function persistRoom(c: any, room: TeamRoom): Promise<void> {
  teamRooms.set(room.code, room);
  if (c.env?.SAFETY_KV) {
    try {
      const raw = {
        code: room.code,
        ownerId: room.ownerId,
        ownerName: room.ownerName,
        createdAt: room.createdAt,
        kickedUserIds: Array.from(room.kickedUserIds),
        disbanded: room.disbanded || false,
      };
      await c.env.SAFETY_KV.put(`room:${room.code}`, JSON.stringify(raw), { expirationTtl: 86400 * 14 });
    } catch (e) {}
  }
}

async function removeRoom(c: any, teamCode: string): Promise<void> {
  teamRooms.delete(teamCode);
  teamLocations.delete(teamCode);
  if (c.env?.SAFETY_KV) {
    try {
      await c.env.SAFETY_KV.delete(`room:${teamCode}`);
    } catch (e) {}
  }
}

async function persistMemberLocation(c: any, teamCode: string, memberLoc: TeamMemberLocation): Promise<void> {
  let team = teamLocations.get(teamCode);
  if (!team) {
    team = new Map();
    teamLocations.set(teamCode, team);
  }
  team.set(memberLoc.userId, memberLoc);

  if (c.env?.SAFETY_KV) {
    try {
      await c.env.SAFETY_KV.put(`member:${teamCode}:${memberLoc.userId}`, JSON.stringify(memberLoc), { expirationTtl: 1800 });
      await c.env.SAFETY_KV.put(`track:${memberLoc.username}`, JSON.stringify({ ...memberLoc, teamCode }), { expirationTtl: 86400 * 3 });
      await c.env.SAFETY_KV.put(`track:${memberLoc.userId}`, JSON.stringify({ ...memberLoc, teamCode }), { expirationTtl: 86400 * 3 });
    } catch (e) {}
  }
}

async function getTeamMembersList(c: any, teamCode: string): Promise<TeamMemberLocation[]> {
  const now = Date.now();
  if (c.env?.SAFETY_KV) {
    try {
      const list = await c.env.SAFETY_KV.list({ prefix: `member:${teamCode}:` });
      if (list && list.keys && list.keys.length > 0) {
        const mems: TeamMemberLocation[] = [];
        for (const k of list.keys) {
          const val = await c.env.SAFETY_KV.get(k.name);
          if (val) {
            try {
              const loc: TeamMemberLocation = JSON.parse(val);
              if (now - loc.updatedAt < 20 * 60 * 1000) {
                mems.push(loc);
              }
            } catch (e) {}
          }
        }
        if (mems.length > 0) return mems;
      }
    } catch (e) {}
  }

  const team = teamLocations.get(teamCode);
  const memList: TeamMemberLocation[] = [];
  if (team) {
    for (const [, loc] of team.entries()) {
      if (now - loc.updatedAt < 20 * 60 * 1000) {
        memList.push(loc);
      }
    }
  }
  return memList;
}

async function removeMemberFromTeam(c: any, teamCode: string, userId: string): Promise<void> {
  const team = teamLocations.get(teamCode);
  if (team) team.delete(userId);
  if (c.env?.SAFETY_KV) {
    try {
      await c.env.SAFETY_KV.delete(`member:${teamCode}:${userId}`);
    } catch (e) {}
  }
}

// ============================================================================
// 3. 极简纯数字账号注册与登录
// ============================================================================
app.post('/api/auth/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();
  const name = String(body.name || '').trim() || `旅行者${username.slice(-4)}`;
  const phone = String(body.phone || '').trim();

  // 校验账号与密码格式
  if (!username || username.length < 2) {
    return c.json({ success: false, message: '账号长度至少需2位字符（支持字母、数字或手机号）' }, 400);
  }
  if (!password || password.length < 3) {
    return c.json({ success: false, message: '密码长度至少需3位字符' }, 400);
  }

  const existingUser = await findUser(c, username);
  if (existingUser) {
    return c.json({ success: false, message: '该账号已被注册，可直接切换至“登录”' }, 400);
  }

  const user: User = {
    id: `user_${username}`,
    username,
    password,
    name,
    avatar: body.avatar || '',
    phone: phone || username,
  };

  await persistUser(c, user);
  const token = `token_${username}_${Date.now()}`;
  await persistSession(c, token, username);

  return c.json({
    success: true,
    message: '注册成功，已自动为您登录',
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
    return c.json({ success: false, message: '请输入账号和密码' }, 400);
  }

  let user = await findUser(c, username);
  if (!user) {
    return c.json({ success: false, message: '账号不存在，请核对或切换至上方“注册新账号”' }, 404);
  }

  if (user.password !== password) {
    return c.json({ success: false, message: '密码错误，请核对后重新输入' }, 401);
  }

  const token = `token_${username}_${Date.now()}`;
  await persistSession(c, token, username);

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

app.post('/api/auth/logout', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token) {
    await removeSession(c, token);
  }
  return c.json({ success: true, message: '已安全退出登录' });
});

app.get('/api/auth/me', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const username = await findSession(c, token);

  if (!username) {
    return c.json({ loggedIn: false }, 401);
  }

  const user = await findUser(c, username);
  if (!user) {
    return c.json({ loggedIn: false }, 401);
  }

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
  const teamCode = body.teamCode ? String(body.teamCode).trim() : '';
  const userId = String(body.userId || 'guest').trim();
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (isNaN(lat) || isNaN(lng)) {
    return c.json({ success: false, message: '坐标无效' }, 400);
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

  const trackingData: UserTrackingLocation = {
    ...memberLoc,
    teamCode: teamCode || undefined,
  };
  userLatestLocations.set(memberLoc.username, trackingData);
  userLatestLocations.set(memberLoc.userId, trackingData);

  // 个人单人模式（未加入任何小队）
  if (!teamCode) {
    return c.json({
      success: true,
      teamCode: '',
      activeCount: 1,
      ownerId: '',
      ownerName: '',
    });
  }

  // 小队房间及生命周期判断
  let room = await findRoom(c, teamCode);
  if (!room) {
    room = {
      code: teamCode,
      ownerId: userId,
      ownerName: memberLoc.name,
      createdAt: Date.now(),
      kickedUserIds: new Set<string>(),
    };
    await persistRoom(c, room);
  } else {
    // 检查房间是否已被解散
    if (room.disbanded) {
      return c.json({
        success: false,
        disbanded: true,
        message: `小队房间 #${teamCode} 已被房主解散`,
      }, 403);
    }

    // 检查该用户是否已被移出/踢出
    if (room.kickedUserIds.has(userId) || room.kickedUserIds.has(memberLoc.username)) {
      return c.json({
        success: false,
        kicked: true,
        message: `您已被移出小队房间 #${teamCode}`,
      }, 403);
    }
  }

  await persistMemberLocation(c, teamCode, memberLoc);
  const activeMembers = await getTeamMembersList(c, teamCode);

  return c.json({
    success: true,
    teamCode,
    activeCount: activeMembers.length,
    ownerId: room.ownerId,
    ownerName: room.ownerName,
  });
});

// ============================================================================
// 4.1 单人专属实时位置动态追踪接口 (公开只读，供外部/亲友实时查看最新位置)
// ============================================================================
app.get('/api/track/:identifier', async (c) => {
  const identifier = String(c.req.param('identifier') || '').trim();
  return await handleTrackingLookup(c, identifier);
});

app.get('/api/track', async (c) => {
  const identifier = String(c.req.query('username') || c.req.query('user') || '').trim();
  return await handleTrackingLookup(c, identifier);
});

async function handleTrackingLookup(c: any, identifier: string) {
  if (!identifier) {
    return c.json({ success: false, message: '请提供待追踪的用户名或用户ID' }, 400);
  }

  let loc = userLatestLocations.get(identifier);

  if (!loc && c.env?.SAFETY_KV) {
    try {
      const data = await c.env.SAFETY_KV.get(`track:${identifier}`);
      if (data) {
        loc = JSON.parse(data);
      }
    } catch (e) {}
  }

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

app.get('/api/team/members', async (c) => {
  const teamCode = String(c.req.query('teamCode') || '').trim();
  const reqUserId = String(c.req.query('userId') || '').trim();

  if (!teamCode) {
    return c.json({
      teamCode: '',
      ownerId: '',
      ownerName: '',
      activeCount: 0,
      members: [],
    });
  }

  const room = await findRoom(c, teamCode);
  if (room && room.disbanded) {
    return c.json({
      teamCode,
      disbanded: true,
      message: `小队房间 #${teamCode} 已被房主解散`,
      ownerId: room.ownerId,
      ownerName: room.ownerName,
      activeCount: 0,
      members: [],
    });
  }

  if (room && reqUserId && room.kickedUserIds.has(reqUserId)) {
    return c.json({
      teamCode,
      kicked: true,
      message: `您已被移出小队房间 #${teamCode}`,
      ownerId: room.ownerId,
      ownerName: room.ownerName,
      activeCount: 0,
      members: [],
    });
  }

  const memberList = await getTeamMembersList(c, teamCode);

  // 房主在线维护：如果原房主离线且有其它活跃成员，顺位转让房主
  if (room && memberList.length > 0) {
    const ownerActive = memberList.some((m) => m.userId === room.ownerId);
    if (!ownerActive) {
      room.ownerId = memberList[0].userId;
      room.ownerName = memberList[0].name;
      await persistRoom(c, room);
    }
  }

  return c.json({
    teamCode,
    ownerId: room ? room.ownerId : (memberList[0]?.userId || ''),
    ownerName: room ? room.ownerName : (memberList[0]?.name || ''),
    activeCount: memberList.length,
    members: memberList,
  });
});

// ============================================================================
// 4.2 退出小队房间 (Leave Team Room)
// ============================================================================
app.post('/api/team/leave', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const teamCode = String(body.teamCode || '').trim();
  const userId = String(body.userId || '').trim();

  if (!teamCode || !userId) {
    return c.json({ success: false, message: '缺少必要参数 (teamCode, userId)' }, 400);
  }

  await removeMemberFromTeam(c, teamCode, userId);

  const userLoc = userLatestLocations.get(userId);
  if (userLoc && userLoc.teamCode === teamCode) {
    delete userLoc.teamCode;
  }

  const room = await findRoom(c, teamCode);
  if (room && room.ownerId === userId) {
    // 房主退出：若还有其他队员，自动移交房主给下一位
    const remaining = await getTeamMembersList(c, teamCode);
    if (remaining.length > 0) {
      room.ownerId = remaining[0].userId;
      room.ownerName = remaining[0].name;
      await persistRoom(c, room);
    } else {
      // 房间已空，回收
      await removeRoom(c, teamCode);
    }
  }

  return c.json({
    success: true,
    message: `已成功退出小队 #${teamCode}`,
  });
});

// ============================================================================
// 4.3 房主踢出成员 (Kick Member)
// ============================================================================
app.post('/api/team/kick', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const teamCode = String(body.teamCode || '').trim();
  const operatorUserId = String(body.operatorUserId || '').trim();
  const targetUserId = String(body.targetUserId || '').trim();

  if (!teamCode || !operatorUserId || !targetUserId) {
    return c.json({ success: false, message: '缺少必要参数' }, 400);
  }

  const room = await findRoom(c, teamCode);
  if (room && room.ownerId && room.ownerId !== operatorUserId) {
    return c.json({ success: false, message: '只有房主/创建者有权移出队员' }, 403);
  }

  if (targetUserId === operatorUserId) {
    return c.json({ success: false, message: '房主不能将自己踢出，如需离开请选择“解散小队”或“退出小队”' }, 400);
  }

  await removeMemberFromTeam(c, teamCode, targetUserId);

  if (room) {
    room.kickedUserIds.add(targetUserId);
    await persistRoom(c, room);
  }

  const userLoc = userLatestLocations.get(targetUserId);
  if (userLoc && userLoc.teamCode === teamCode) {
    delete userLoc.teamCode;
  }

  return c.json({
    success: true,
    message: '已成功将该成员移出小队',
    targetUserId,
  });
});

// ============================================================================
// 4.4 房主解散小队房间 (Disband Team Room)
// ============================================================================
app.post('/api/team/disband', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const teamCode = String(body.teamCode || '').trim();
  const operatorUserId = String(body.operatorUserId || '').trim();

  if (!teamCode || !operatorUserId) {
    return c.json({ success: false, message: '缺少必要参数' }, 400);
  }

  const room = await findRoom(c, teamCode);
  if (room && room.ownerId && room.ownerId !== operatorUserId) {
    return c.json({ success: false, message: '只有房主/创建者有权解散该小队房间' }, 403);
  }

  if (room) {
    room.disbanded = true;
    await persistRoom(c, room);
  }

  // 清空房间及位置数据
  await removeRoom(c, teamCode);

  return c.json({
    success: true,
    message: `小队房间 #${teamCode} 已被成功解散`,
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

    if (c.env?.SAFETY_KV) {
      try {
        await c.env.SAFETY_KV.put(`img:${imageId}`, arrayBuffer, {
          metadata: { mimeType, filename },
          expirationTtl: 86400 * 30,
        });
      } catch (e) {}
    }

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

app.get('/api/images/:id', async (c) => {
  const id = c.req.param('id');
  const img = storedImages.get(id);

  if (img) {
    return new Response(img.data, {
      status: 200,
      headers: {
        'Content-Type': img.mimeType,
        'Cache-Control': 'public, max-age=86400',
        'Content-Disposition': `inline; filename="${img.filename}"`,
      },
    });
  }

  if (c.env?.SAFETY_KV) {
    try {
      const kvResult = await c.env.SAFETY_KV.getWithMetadata<{ mimeType?: string; filename?: string }>(`img:${id}`, 'arrayBuffer');
      if (kvResult && kvResult.value) {
        const mimeType = kvResult.metadata?.mimeType || 'image/jpeg';
        const filename = kvResult.metadata?.filename || `${id}.jpg`;
        return new Response(kvResult.value, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=86400',
            'Content-Disposition': `inline; filename="${filename}"`,
          },
        });
      }
    } catch (e) {}
  }

  return c.text('Image Not Found', 404);
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
