/**
 * 护途 · 泰国行程安全中心 (HuTu Thailand Safety Console)
 * 前端核心业务与交互驱动
 */

(function () {
  'use strict';

  // ==========================================
  // 1. 本地存储数据模型与默认状态
  // ==========================================
  const STORAGE_KEYS = {
    PROFILE: 'hutu_profile',
    CONTACTS: 'hutu_contacts',
    SETTINGS: 'hutu_settings',
    LAST_LOCATION: 'hutu_last_location',
    THEME: 'hutu_theme',
    AUTH_TOKEN: 'hutu_auth_token',
    AUTH_USER: 'hutu_auth_user',
    TEAM_CODE: 'hutu_team_code',
  };

  const DEFAULT_BANGKOK = {
    lat: 13.7563,
    lng: 100.5018,
    accuracy: 25,
    city: '曼谷 (Bangkok)',
  };

  const MAP_SOURCES = {
    amap: {
      id: 'amap',
      name: '高德线图',
      fullName: '高德官方矢量线图',
      url: 'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
      options: {
        subdomains: '1234',
        maxZoom: 18,
        minZoom: 3,
        attribution: '© AutoNavi',
      },
    },
    osm: {
      id: 'osm',
      name: '全球线图',
      fullName: '全球标准出行线图 (OSM)',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        minZoom: 1,
        attribution: '© OpenStreetMap contributors',
      },
    },
    dark: {
      id: 'dark',
      name: '深曜极客',
      fullName: '深曜石极客暗色线图 (ESRI)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 16,
        minZoom: 1,
        attribution: '© Esri, HERE, Garmin',
      },
    },
    sat: {
      id: 'sat',
      name: '高德卫星',
      fullName: '高德全景卫星影像',
      url: 'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}',
      options: {
        subdomains: '1234',
        maxZoom: 18,
        minZoom: 3,
        attribution: '© AutoNavi Satellite',
      },
    },
  };

  function isChinaCoordinate(lng, lat, addressCountry) {
    if (addressCountry) {
      return addressCountry === '中国' || addressCountry === 'China';
    }
    if (lat < 18.0 || lat > 54.0 || lng < 73.0 || lng > 135.5) return false;
    if (lat < 21.2 && lng < 107.5) return false;
    return true;
  }

  function getStoredMapSource() {
    try {
      const s = localStorage.getItem('thai_service_map_source');
      if (s && MAP_SOURCES[s]) return s;
    } catch (e) {}
    try {
      const savedLoc = localStorage.getItem(STORAGE_KEYS.LAST_LOCATION);
      if (savedLoc) {
        const loc = JSON.parse(savedLoc);
        if (loc && loc.lng && loc.lat && isChinaCoordinate(loc.lng, loc.lat)) {
          return 'amap';
        }
      }
    } catch (e) {}
    // 默认展示泰国曼谷，泰国/海外默认必须加载全球标准出行线图 (OSM)
    return 'osm';
  }

  function createTileLayer(sourceId) {
    const src = MAP_SOURCES[sourceId] || MAP_SOURCES.amap;
    return L.tileLayer(src.url, src.options);
  }

  let state = {
    theme: 'dark',
    currentMapSource: getStoredMapSource(),
    user: null,
    token: null,
    teamCode: '666888',
    roomOwnerId: '',
    roomOwnerName: '',
    isRoomOwner: false,
    teamMembers: [],
    overviewTeamMarkers: new Map(),
    radarMap: null,
    radarMarker: null,
    radarTileLayer: null,
    radarTeamMarkers: new Map(),
    profile: {
      name: '',
      age: '',
      phone: '',
      address: '',
      passport: '',
      medical: '',
      avatar: '',
    },
    contacts: [
      {
        id: '1',
        name: '紧急联系人1',
        relation: '直系亲属/父母',
        phone: '',
        isPrimary: true,
      },
      {
        id: '2',
        name: '同行伙伴/酒店',
        relation: '同伴/导游',
        phone: '',
        isPrimary: false,
      },
    ],
    location: {
      lat: null,
      lng: null,
      accuracy: null,
      updated: null,
      granted: false,
    },
    settings: {
      highAccuracy: true,
    },
    map: null,
    tileLayer: null,
    marker: null,
  };

  // ==========================================
  // 2. 初始化与生命周期
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    loadLocalData();
    initTheme();
    initIcons();
    initAuthSystem();
    initNavigation();
    initMap();
    initRadarMap();
    initProfileForm();
    initContactsManager();
    initEmergencyModal();
    initSettingsView();
    initTeamSystem();
    initImageUpload();
    initLiveTrackingViewer();
    updateAllViews();
    fetchBackendHealth();

    // 仅在已登录状态下才触发高精度定位与 IP 对齐；未登录状态绝不定位
    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
    if (isLoggedIn) {
      requestGeolocation(false);
      fetchIpLocationFallback();
    } else {
      updateLocationUI();
    }
  });

  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  // ==========================================
  // 3. 数据持久化与状态恢复
  // ==========================================
  function loadLocalData() {
    try {
      const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
      if (savedProfile) {
        state.profile = { ...state.profile, ...JSON.parse(savedProfile) };
      }

      const savedContacts = localStorage.getItem(STORAGE_KEYS.CONTACTS);
      if (savedContacts) {
        const parsed = JSON.parse(savedContacts);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.contacts = parsed;
        }
      }

      const savedToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const savedUser = localStorage.getItem(STORAGE_KEYS.AUTH_USER);
      if (savedToken && savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          if (parsedUser && parsedUser.id && !parsedUser.id.startsWith('user_guest') && !(parsedUser.name && parsedUser.name.startsWith('行者'))) {
            state.token = savedToken;
            state.user = parsedUser;
          } else {
            state.token = null;
            state.user = null;
            localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
            localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
          }
        } catch (e) {
          state.token = null;
          state.user = null;
        }
      } else {
        state.token = null;
        state.user = null;
      }

      // 未登录状态绝对不恢复历史定位，实现“未登录就没有定位”
      const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
      if (isLoggedIn) {
        const savedLoc = localStorage.getItem(STORAGE_KEYS.LAST_LOCATION);
        if (savedLoc) {
          const parsedLoc = JSON.parse(savedLoc);
          state.location = { ...state.location, ...parsedLoc };
        }
      } else {
        state.location = {
          lat: null,
          lng: null,
          accuracy: null,
          updated: null,
          granted: false,
          city: '',
        };
        try {
          localStorage.removeItem(STORAGE_KEYS.LAST_LOCATION);
        } catch (e) {}
      }

      const savedTeam = localStorage.getItem(STORAGE_KEYS.TEAM_CODE);
      if (savedTeam !== null) {
        state.teamCode = savedTeam;
      }
    } catch (e) {
      console.warn('读取本地存储异常:', e);
    }
  }

  function saveProfileData() {
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(state.profile));
      updateAllViews();
      showToast('个人安全档案已更新并加密存储在本地');
    } catch (e) {
      showToast('存储档案失败', 'error');
    }
  }

  function saveContactsData() {
    try {
      localStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(state.contacts));
      updateAllViews();
      showToast('紧急联系人名单已成功保存');
    } catch (e) {
      showToast('保存联系人失败', 'error');
    }
  }

  // ==========================================
  // 主题切换系统 (深色护盾 / 浅色日光)
  // ==========================================
  function initTheme() {
    let savedTheme = 'dark';
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.THEME);
      if (stored) {
        savedTheme = stored;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        savedTheme = 'light';
      }
    } catch (e) {}

    setTheme(savedTheme, false);

    // 绑定顶部栏切换按钮
    const topThemeBtn = document.getElementById('theme-toggle');
    if (topThemeBtn) {
      topThemeBtn.addEventListener('click', () => {
        const nextTheme = state.theme === 'light' ? 'dark' : 'light';
        setTheme(nextTheme, true);
      });
    }
  }

  function setTheme(theme, save = true) {
    const isLight = theme === 'light';
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);

    // 更新顶栏按钮图标与浮窗说明
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.setAttribute('title', isLight ? '切换为深色护盾外观' : '切换为浅色日光外观');
      themeBtn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}" id="theme-toggle-icon"></i>`;
    }

    // 保持纯净底图图层，自适应容器渲染
    if (state.map) state.map.invalidateSize();
    if (state.radarMap) state.radarMap.invalidateSize();

    if (save) {
      try {
        localStorage.setItem(STORAGE_KEYS.THEME, theme);
      } catch (e) {}
      showToast(isLight ? '已切换至清爽日光浅色模式' : '已切换至深曜石护盾暗色模式');
    }

    initIcons();
  }

  // ==========================================
  // 4. 视图导航切换
  // ==========================================
  function initNavigation() {
    const navItems = document.querySelectorAll('[data-view]');
    const viewPanels = document.querySelectorAll('[data-view-panel]');
    const currentLabel = document.getElementById('current-view-label');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');

    const viewNames = {
      overview: '总览中控',
      radar: '实时定位雷达',
      profile: '我的安全档案',
      contacts: '紧急联系人',
      settings: '安全设置',
    };

    function switchView(targetView) {
      if (!viewNames[targetView]) return;

      // 更新按钮激活态
      document.querySelectorAll('[data-view]').forEach((btn) => {
        if (btn.getAttribute('data-view') === targetView) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // 切换视图面板
      viewPanels.forEach((panel) => {
        if (panel.getAttribute('data-view-panel') === targetView) {
          panel.removeAttribute('hidden');
          panel.classList.add('active');
        } else {
          panel.setAttribute('hidden', '');
          panel.classList.remove('active');
        }
      });

      if (currentLabel) {
        currentLabel.textContent = viewNames[targetView];
      }

      // 移动端关闭侧边栏
      if (sidebar) {
        sidebar.classList.remove('open');
      }

      // 如果切到总览或雷达，重新调整地图尺寸
      if (targetView === 'overview' && state.map) {
        requestAnimationFrame(() => state.map?.invalidateSize());
        setTimeout(() => state.map?.invalidateSize(), 100);
        setTimeout(() => state.map?.invalidateSize(), 300);
      } else if (targetView === 'radar' && state.radarMap) {
        requestAnimationFrame(() => state.radarMap?.invalidateSize());
        setTimeout(() => state.radarMap?.invalidateSize(), 100);
        setTimeout(() => state.radarMap?.invalidateSize(), 300);
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    navItems.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const view = btn.getAttribute('data-view');
        if (view) {
          e.preventDefault();
          switchView(view);
        }
      });
    });

    // 移动端汉堡菜单
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('open');
      });

      document.addEventListener('click', (e) => {
        if (!sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
          sidebar.classList.remove('open');
        }
      });
    }
  }

  // ==========================================
  // 5. Leaflet 暗色地图与高精度地理定位
  // ==========================================
  function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer || !window.L) return;

    const initialLat = state.location.lat || DEFAULT_BANGKOK.lat;
    const initialLng = state.location.lng || DEFAULT_BANGKOK.lng;

    // 若当前坐标在泰国/海外，且当前底图为高德（高德海外为空白），自动智能采用全球线图 OSM
    if (!isChinaCoordinate(initialLng, initialLat) && (state.currentMapSource === 'amap' || state.currentMapSource === 'sat')) {
      state.currentMapSource = 'osm';
    }

    const disp = toMapCoordinate(initialLat, initialLng);

    state.map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
    }).setView([disp.lat, disp.lng], 12);

    // 加载纯净无水印底图
    state.tileLayer = createTileLayer(state.currentMapSource).addTo(state.map);

    // 定制高科技脉冲标记
    const pulseIcon = L.divIcon({
      className: 'custom-map-pulse',
      html: `
        <div style="position: relative; width: 22px; height: 22px;">
          <div style="width: 14px; height: 14px; background: #10B981; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 10px #10B981; position: absolute; top: 4px; left: 4px; z-index: 2;"></div>
          <div style="width: 22px; height: 22px; background: rgba(16, 185, 129, 0.4); border-radius: 50%; animation: radar-ping 1.8s infinite; position: absolute;"></div>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
    if (isLoggedIn && state.location.granted && state.location.lat !== null) {
      state.marker = L.marker([disp.lat, disp.lng], { icon: pulseIcon }).addTo(state.map);
    } else {
      state.marker = null;
    }

    // 定位主切换按钮与状态指示胶囊
    const toggleBtn = document.getElementById('location-toggle');
    const topLocStatus = document.getElementById('top-location-status');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => requestGeolocation(true));
    }
    if (topLocStatus) {
      topLocStatus.addEventListener('click', () => requestGeolocation(true));
    }

    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => {
        if (state.map && mapContainer.offsetWidth > 0 && mapContainer.offsetHeight > 0) {
          state.map.invalidateSize();
        }
      });
      resizeObserver.observe(mapContainer);
    }
  }

  // ==========================================
  // 高德地图开放平台高精定位与坐标转换系统
  // Leaflet OSM 底图采用 WGS-84，高德在中国境内采用火星坐标 GCJ-02
  // ==========================================
  let amapGeolocationInstance = null;
  let amapGeocoderInstance = null;
  let isCalibrating = false;

  function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
    return ret;
  }

  function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
    return ret;
  }

  function gcj02ToWgs84(lng, lat) {
    const a = 6378245.0;
    const ee = 0.00669342162296594323;
    if (!isChinaCoordinate(lng, lat)) {
      return { lng, lat };
    }
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = (lat / 180.0) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
    dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
    const mgLat = lat + dLat;
    const mgLng = lng + dLng;
    return {
      lng: Number((lng * 2 - mgLng).toFixed(6)),
      lat: Number((lat * 2 - mgLat).toFixed(6)),
    };
  }

  function wgs84ToGcj02(lng, lat) {
    const a = 6378245.0;
    const ee = 0.00669342162296594323;
    if (!isChinaCoordinate(lng, lat)) {
      return { lng, lat };
    }
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = (lat / 180.0) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
    dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
    return {
      lng: Number((lng + dLng).toFixed(6)),
      lat: Number((lat + dLat).toFixed(6)),
    };
  }

  // 地图瓦片源坐标系映射：高德国内底图采用 GCJ-02，全球 OSM / ESRI 采用 WGS-84
  function toMapCoordinate(lat, lng) {
    if (!lat || !lng) return { lat: DEFAULT_BANGKOK.lat, lng: DEFAULT_BANGKOK.lng };
    if (!isChinaCoordinate(lng, lat)) {
      return { lat: Number(lat), lng: Number(lng) };
    }
    if (state.currentMapSource === 'amap' || state.currentMapSource === 'sat') {
      return wgs84ToGcj02(lng, lat);
    }
    return { lat: Number(lat), lng: Number(lng) };
  }

  function fromMapCoordinate(lat, lng) {
    if (!lat || !lng) return { lat: DEFAULT_BANGKOK.lat, lng: DEFAULT_BANGKOK.lng };
    if (!isChinaCoordinate(lng, lat)) {
      return { lat: Number(lat), lng: Number(lng) };
    }
    if (state.currentMapSource === 'amap' || state.currentMapSource === 'sat') {
      return gcj02ToWgs84(lng, lat);
    }
    return { lat: Number(lat), lng: Number(lng) };
  }

  // 切换地图源（高德线图 / 全球OSM / 深曜暗色 / 高德卫星）
  function switchMapSource(sourceId, notify = true) {
    const src = MAP_SOURCES[sourceId];
    if (!src) return;

    state.currentMapSource = sourceId;
    try {
      localStorage.setItem('thai_service_map_source', sourceId);
    } catch (e) {}

    // 1. 更新概览中控底图
    if (state.map && state.tileLayer) {
      state.map.removeLayer(state.tileLayer);
      state.tileLayer = createTileLayer(sourceId).addTo(state.map);
    }

    // 2. 更新雷达全屏底图
    if (state.radarMap && state.radarTileLayer) {
      state.radarMap.removeLayer(state.radarTileLayer);
      state.radarTileLayer = createTileLayer(sourceId).addTo(state.radarMap);
    }

    // 3. 更新雷达顶部工具栏切换按钮与下拉列表激活项
    const currentNameEl = document.getElementById('radar-layer-current-name');
    if (currentNameEl) {
      currentNameEl.textContent = src.name;
    }

    const layerItems = document.querySelectorAll('.radar-layer-item');
    layerItems.forEach((item) => {
      if (item.getAttribute('data-layer-id') === sourceId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // 4. 重定位地图视野及标点（GCJ-02 <-> WGS-84 自动对齐当前底图）
    if (state.map && state.marker) {
      const myLat = state.location.lat || DEFAULT_BANGKOK.lat;
      const myLng = state.location.lng || DEFAULT_BANGKOK.lng;
      const disp = toMapCoordinate(myLat, myLng);
      state.marker.setLatLng([disp.lat, disp.lng]);
    }
    if (state.radarMap) {
      updateMyRadarMarker();
    }
    updateTeamMapMarkers();

    if (notify) {
      const myLat = state.location.lat || DEFAULT_BANGKOK.lat;
      const myLng = state.location.lng || DEFAULT_BANGKOK.lng;
      if ((sourceId === 'amap' || sourceId === 'sat') && !isChinaCoordinate(myLng, myLat)) {
        showToast(`已切换至【${src.fullName}】。⚠️ 提示：高德官方底图仅覆盖中国大陆港澳，泰国等海外为空白。查看泰国请选用【全球标准出行线图 (OSM)】！`, 'warning');
      } else {
        showToast(`底图已切换至：${src.fullName} (纯净无水印)`);
      }
    }
  }

  function initAMapGeolocation() {
    if (window.AMap && window.AMap.Geolocation && !amapGeolocationInstance) {
      try {
        amapGeolocationInstance = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
          needAddress: true,
          extensions: 'all',
          noIpLocate: 0,
          noGeoLocation: 0,
        });
      } catch (e) {
        console.warn('高德定位插件初始化未就绪:', e);
      }
    }
    if (window.AMap && window.AMap.Geocoder && !amapGeocoderInstance) {
      try {
        amapGeocoderInstance = new AMap.Geocoder();
      } catch (e) {}
    }
  }

  function reverseGeocodeLocation(lat, lng) {
    if (!amapGeocoderInstance && window.AMap && window.AMap.Geocoder) {
      try {
        amapGeocoderInstance = new AMap.Geocoder();
      } catch (e) {}
    }
    if (amapGeocoderInstance) {
      let queryLng = lng;
      let queryLat = lat;
      if (isChinaCoordinate(lng, lat)) {
        const gcj = wgs84ToGcj02(lng, lat);
        queryLng = gcj.lng;
        queryLat = gcj.lat;
      }
      amapGeocoderInstance.getAddress([queryLng, queryLat], (status, result) => {
        if (status === 'complete' && result.regeocode) {
          const addr = result.regeocode.formattedAddress;
          const comp = result.regeocode.addressComponent;
          const city = comp ? (comp.city || comp.province || '') : '';
          if (addr) {
            state.location.address = addr;
            if (city) state.location.city = city;
            updateLocationUI();
          }
        }
      });
    }
  }

  function applyLocationToMaps(lat, lng) {
    const disp = toMapCoordinate(lat, lng);
    const newLatLng = [disp.lat, disp.lng];
    if (state.map && state.marker) {
      state.marker.setLatLng(newLatLng);
      state.map.setView(newLatLng, 15);
    }
    if (state.radarMap) {
      updateMyRadarMarker();
      state.radarMap.setView(newLatLng, 15);
    }
  }

  function applyManualCalibration(lat, lng) {
    const norm = fromMapCoordinate(lat, lng);
    const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    state.location = {
      ...state.location,
      lat: Number(norm.lat.toFixed(6)),
      lng: Number(norm.lng.toFixed(6)),
      accuracy: 5,
      updated: nowStr,
      granted: true,
      source: 'manual',
    };

    reverseGeocodeLocation(norm.lat, norm.lng);

    try {
      localStorage.setItem(STORAGE_KEYS.LAST_LOCATION, JSON.stringify(state.location));
    } catch (e) {}

    applyLocationToMaps(norm.lat, norm.lng);
    updateLocationUI();
    updateReadinessScore();

    if (state.user) {
      reportMyLocation();
    }

    showToast(`定位已精准对齐至：[${norm.lat.toFixed(4)}, ${norm.lng.toFixed(4)}] (全队已同步)`);
  }

  function handleAMapLocationSuccess(result, manualTrigger) {
    const rawLng = result.position.lng;
    const rawLat = result.position.lat;
    const country = result.addressComponent ? result.addressComponent.country : '';

    let finalLng = rawLng;
    let finalLat = rawLat;
    const isDomestic = isChinaCoordinate(rawLng, rawLat, country);
    if (isDomestic) {
      const wgs = gcj02ToWgs84(rawLng, rawLat);
      finalLng = wgs.lng;
      finalLat = wgs.lat;
      if (state.currentMapSource !== 'amap' && !localStorage.getItem('thai_service_map_source')) {
        switchMapSource('amap', false);
      }
    } else {
      if (state.currentMapSource === 'amap' || state.currentMapSource === 'sat') {
        switchMapSource('osm', false);
        showToast('检测到当前位于泰国/海外，高德切片仅限中国境内，已自动为您启用【全球标准出行线图 (OSM)】！');
      }
    }

    const accuracy = Math.round(result.accuracy || 20);
    const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const formattedAddress = result.formattedAddress || '';
    const comp = result.addressComponent;
    const city = comp ? (comp.city || comp.province || '') : '';

    state.location = {
      lat: Number(finalLat.toFixed(6)),
      lng: Number(finalLng.toFixed(6)),
      accuracy: accuracy,
      updated: nowStr,
      granted: true,
      source: 'amap',
      address: formattedAddress,
      city: city,
    };

    try {
      localStorage.setItem(STORAGE_KEYS.LAST_LOCATION, JSON.stringify(state.location));
    } catch (e) {}

    applyLocationToMaps(finalLat, finalLng);

    const toggleText = document.getElementById('location-toggle-text');
    if (toggleText) toggleText.textContent = '高德高精刷新';

    if (manualTrigger) {
      showToast(`高德高精定位已锁定！(误差约 ±${accuracy}米${formattedAddress ? ` · ${formattedAddress}` : ''})`);
    }

    updateLocationUI();
    updateReadinessScore();

    if (state.user) {
      reportMyLocation();
    }
  }

  function requestNativeGeolocation(manualTrigger) {
    if (!navigator.geolocation) {
      const stateEl = document.getElementById('location-state');
      if (stateEl) stateEl.innerHTML = '<span class="status-dot status-dot-warn"></span><span>设备不支持定位</span>';
      if (manualTrigger) showToast('当前设备或浏览器不支持定位 API', 'error');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        if (!isChinaCoordinate(longitude, latitude)) {
          if (state.currentMapSource === 'amap' || state.currentMapSource === 'sat') {
            switchMapSource('osm', false);
            showToast('检测到当前位于泰国/海外，已自动为您切换为【全球标准出行线图 (OSM)】！');
          }
        }

        state.location = {
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          accuracy: Math.round(accuracy),
          updated: nowStr,
          granted: true,
          source: 'gps',
          address: '',
          city: '',
        };

        reverseGeocodeLocation(latitude, longitude);

        try {
          localStorage.setItem(STORAGE_KEYS.LAST_LOCATION, JSON.stringify(state.location));
        } catch (e) {}

        applyLocationToMaps(latitude, longitude);

        const toggleText = document.getElementById('location-toggle-text');
        if (toggleText) toggleText.textContent = '刷新定位';
        if (manualTrigger) showToast(`GPS 定位已更新 (误差约 ±${Math.round(accuracy)}米)`);

        updateLocationUI();
        updateReadinessScore();

        if (state.user) {
          reportMyLocation();
        }
      },
      (err) => {
        console.warn('浏览器原生定位获取失败:', err.message);
        state.location.granted = false;

        const stateEl = document.getElementById('location-state');
        const topText = document.getElementById('top-location-text');
        const topDot = document.getElementById('top-location-dot');

        if (stateEl) {
          stateEl.innerHTML = '<span class="status-dot status-dot-warn"></span><span>点击刷新定位</span>';
        }
        if (topDot) {
          topDot.className = 'status-dot status-dot-warn';
        }
        if (manualTrigger) {
          showToast('无法获取GPS精确定位，请在手机或浏览器权限中开启“位置信息”', 'warning');
        }

        // 启动网络 IP 定位兜底，避免漂移到泰国曼谷
        fetchIpLocationFallback();

        updateLocationUI();
        updateReadinessScore();
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  }

  function fetchIpLocationFallback() {
    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
    if (!isLoggedIn) return;

    fetch('/api/geo')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.lat && data.lng && (!state.location.granted || state.location.lat === null)) {
          state.location.lat = Number(data.lat.toFixed(6));
          state.location.lng = Number(data.lng.toFixed(6));
          state.location.city = data.city || data.region || '';
          state.location.accuracy = 3000;
          state.location.source = 'ip';
          state.location.granted = true;

          const topText = document.getElementById('top-location-text');
          if (topText) topText.textContent = data.city ? `${data.city} (IP定位)` : (data.region || '当前网络位置');

          applyLocationToMaps(data.lat, data.lng);
          updateLocationUI();
          if (state.user) {
            reportMyLocation();
          }
        }
      })
      .catch(() => {});
  }

  function requestGeolocation(manualTrigger = false) {
    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
    if (!isLoggedIn) {
      if (manualTrigger) {
        showToast('未登录状态不开放定位，请先登录或注册账号', 'warning');
        const authModal = document.getElementById('auth-modal');
        authModal?.removeAttribute('hidden');
      }
      updateLocationUI();
      return;
    }

    const stateEl = document.getElementById('location-state');
    const topText = document.getElementById('top-location-text');

    if (stateEl) stateEl.innerHTML = '<span class="status-dot status-dot-warn"></span><span>正在调用高德高精度定位...</span>';
    if (topText) topText.textContent = '高德定位中...';

    // 优先调用高德开放平台 AMap.Geolocation
    if (window.AMap && window.AMap.Geolocation) {
      if (!amapGeolocationInstance) {
        initAMapGeolocation();
      }

      if (amapGeolocationInstance) {
        amapGeolocationInstance.getCurrentPosition((status, result) => {
          if (status === 'complete' && result.position) {
            handleAMapLocationSuccess(result, manualTrigger);
          } else {
            console.warn('高德定位未完全返回，回退至原生浏览器定位:', result);
            requestNativeGeolocation(manualTrigger);
          }
        });
        return;
      }
    }

    // 回退到原生定位
    requestNativeGeolocation(manualTrigger);
  }

  function updateLocationUI() {
    const latEl = document.getElementById('location-lat');
    const lngEl = document.getElementById('location-lng');
    const accEl = document.getElementById('location-accuracy');
    const updatedEl = document.getElementById('location-updated');
    const stateEl = document.getElementById('location-state');
    const topText = document.getElementById('top-location-text');
    const topDot = document.getElementById('top-location-dot');
    const pill = document.getElementById('top-location-status');
    const checkLocText = document.getElementById('check-location-text');
    const checkLocIcon = document.querySelector('[data-check="location"]');
    const settingsLocState = document.getElementById('settings-location-state');

    const radarLat = document.getElementById('radar-stat-lat');
    const radarLng = document.getElementById('radar-stat-lng');
    const radarAcc = document.getElementById('radar-stat-acc');
    const radarGpsStatusText = document.getElementById('radar-gps-status-text');
    const radarAddrBox = document.getElementById('radar-stat-addr-box');
    const radarAddrText = document.getElementById('radar-stat-addr');
    const radarAddrDivider = document.getElementById('radar-stat-addr-divider');

    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));

    // 未登录完全无定位处理
    if (!isLoggedIn) {
      if (latEl) latEl.textContent = '--';
      if (lngEl) lngEl.textContent = '--';
      if (accEl) accEl.textContent = '--';
      if (updatedEl) updatedEl.textContent = '未登录';
      if (radarLat) radarLat.textContent = '--';
      if (radarLng) radarLng.textContent = '--';
      if (radarAcc) radarAcc.textContent = '--';
      if (radarGpsStatusText) radarGpsStatusText.textContent = '未登录 · 定位未开启';
      if (radarAddrBox) radarAddrBox.style.display = 'none';
      if (radarAddrDivider) radarAddrDivider.style.display = 'none';
      if (stateEl) stateEl.innerHTML = '<span class="status-dot status-dot-warn"></span><span>未登录（点击顶栏登录后开启定位）</span>';
      if (topText) topText.textContent = '未登录 · 无定位';
      if (topDot) topDot.className = 'status-dot status-dot-warn';
      if (pill) pill.classList.remove('active');
      if (checkLocText) checkLocText.textContent = '未登录';
      if (checkLocIcon) checkLocIcon.innerHTML = '<i data-lucide="circle"></i>';
      if (settingsLocState) {
        settingsLocState.className = 'status-badge-neutral';
        settingsLocState.textContent = '未登录账号 (登录后开启定位)';
      }
      if (state.marker && state.map) {
        state.map.removeLayer(state.marker);
        state.marker = null;
      }
      if (state.radarMarker && state.radarMap) {
        state.radarMap.removeLayer(state.radarMarker);
        state.radarMarker = null;
      }
      initIcons();
      return;
    }

    const hasCoords = state.location.lat !== null;

    if (latEl) latEl.textContent = hasCoords ? state.location.lat : '--';
    if (lngEl) lngEl.textContent = hasCoords ? state.location.lng : '--';
    if (accEl) accEl.textContent = hasCoords ? `±${state.location.accuracy} 米` : '--';
    if (updatedEl) updatedEl.textContent = state.location.updated || '尚未获取';

    if (radarLat) radarLat.textContent = hasCoords ? state.location.lat : DEFAULT_BANGKOK.lat;
    if (radarLng) radarLng.textContent = hasCoords ? state.location.lng : DEFAULT_BANGKOK.lng;
    if (radarAcc) radarAcc.textContent = hasCoords ? `±${state.location.accuracy}m` : '±20m';

    if (radarAddrBox && radarAddrText) {
      if (state.location.address) {
        radarAddrBox.style.display = 'block';
        if (radarAddrDivider) radarAddrDivider.style.display = 'block';
        radarAddrText.textContent = state.location.address;
        radarAddrText.title = state.location.address;
      } else {
        radarAddrBox.style.display = 'none';
        if (radarAddrDivider) radarAddrDivider.style.display = 'none';
      }
    }

    if (radarGpsStatusText) {
      if (state.location.source === 'amap') {
        radarGpsStatusText.textContent = `高德高精定位已锁定 (±${state.location.accuracy}m)`;
      } else if (state.location.source === 'manual') {
        radarGpsStatusText.textContent = `手动校准锁定 (±5m)`;
      } else if (state.location.granted) {
        radarGpsStatusText.textContent = `高精定位已锁定 (±${state.location.accuracy}m)`;
      } else {
        radarGpsStatusText.textContent = '高德高精定位就绪';
      }
    }

    if (state.location.granted) {
      const sourceBadge = state.location.source === 'amap' ? '高德高精已锁定' : (state.location.source === 'manual' ? '手动校准锁定' : '高精度 GPS 锁定');
      if (stateEl) stateEl.innerHTML = `<span class="status-dot status-dot-active"></span><span>${sourceBadge}</span>`;
      if (topText) {
        topText.textContent = state.location.city || (state.location.address ? state.location.address.slice(0, 10) + '...' : `${state.location.lat}, ${state.location.lng}`);
      }
      if (topDot) topDot.className = 'status-dot status-dot-active';
      if (pill) pill.classList.add('active');
      if (checkLocText) checkLocText.textContent = '已获取';
      if (checkLocIcon) checkLocIcon.innerHTML = '<i data-lucide="check-circle-2"></i>';
      if (settingsLocState) {
        settingsLocState.className = 'text-emerald';
        settingsLocState.textContent = '已授权高精定位 (高德/GPS)';
      }
    } else {
      if (checkLocText) checkLocText.textContent = '未授权';
      if (checkLocIcon) checkLocIcon.innerHTML = '<i data-lucide="circle"></i>';
      if (settingsLocState) {
        settingsLocState.className = 'status-badge-neutral';
        settingsLocState.textContent = '未开启定位授权';
      }
    }

    initIcons();
  }

  // ==========================================
  // 6. 出行就绪度打分 (Readiness Score)
  // ==========================================
  function updateReadinessScore() {
    const { name, age, phone, address } = state.profile;
    let profileFilled = 0;
    if (name.trim()) profileFilled++;
    if (age) profileFilled++;
    if (phone.trim()) profileFilled++;
    if (address.trim()) profileFilled++;

    const contactsValid = state.contacts.filter((c) => c.name.trim() && c.phone.trim()).length;
    const locationReady = state.location.granted ? 1 : 0;

    // 权重计算 (满分 100%)
    // 档案: 40% (每项 10%)
    // 联系人: 40% (每位 20%，最多 2 位即达 40%)
    // 定位: 20%
    const scoreProfile = profileFilled * 10;
    const scoreContacts = Math.min(contactsValid * 20, 40);
    const scoreLocation = locationReady * 20;

    const totalScore = scoreProfile + scoreContacts + scoreLocation;

    const readinessVal = document.getElementById('readiness-value');
    const readinessProgress = document.getElementById('readiness-progress');
    const responseReadiness = document.getElementById('response-readiness');
    const checkProfileCount = document.getElementById('check-profile-count');
    const checkContactsCount = document.getElementById('check-contacts-count');
    const checkProfileItem = document.getElementById('check-profile-item');
    const checkContactsItem = document.getElementById('check-contacts-item');
    const checkLocationItem = document.getElementById('check-location-item');

    if (readinessVal) readinessVal.textContent = `${totalScore}%`;
    if (readinessProgress) readinessProgress.style.width = `${totalScore}%`;

    if (responseReadiness) {
      if (totalScore >= 80) {
        responseReadiness.textContent = '完备就绪';
        responseReadiness.style.color = 'var(--emerald-400)';
      } else if (totalScore >= 40) {
        responseReadiness.textContent = '基本可用';
        responseReadiness.style.color = 'var(--amber-400)';
      } else {
        responseReadiness.textContent = '待完善资料';
        responseReadiness.style.color = 'var(--crimson-400)';
      }
    }

    if (checkProfileCount) checkProfileCount.textContent = `${profileFilled} / 4 项`;
    if (checkContactsCount) checkContactsCount.textContent = `${contactsValid} / 5 位`;

    const iconProfile = document.querySelector('[data-check="profile"]');
    const iconContacts = document.querySelector('[data-check="contacts"]');

    if (profileFilled >= 4) {
      checkProfileItem?.classList.add('done');
      if (iconProfile) iconProfile.innerHTML = '<i data-lucide="check-circle-2"></i>';
    } else {
      checkProfileItem?.classList.remove('done');
      if (iconProfile) iconProfile.innerHTML = '<i data-lucide="circle"></i>';
    }

    if (contactsValid >= 2) {
      checkContactsItem?.classList.add('done');
      if (iconContacts) iconContacts.innerHTML = '<i data-lucide="check-circle-2"></i>';
    } else {
      checkContactsItem?.classList.remove('done');
      if (iconContacts) iconContacts.innerHTML = '<i data-lucide="circle"></i>';
    }

    if (locationReady) {
      checkLocationItem?.classList.add('done');
    } else {
      checkLocationItem?.classList.remove('done');
    }

    initIcons();
  }

  // ==========================================
  // 7. 个人档案表单与全息卡片联动
  // ==========================================
  function initProfileForm() {
    const form = document.getElementById('profile-form');
    if (!form) return;

    // 填充已有数据
    ['name', 'age', 'phone', 'address', 'passport', 'medical'].forEach((field) => {
      const input = document.getElementById(`profile-${field}`);
      if (input && state.profile[field]) {
        input.value = state.profile[field];
      }
    });

    // 实时联动右侧预览
    form.addEventListener('input', (e) => {
      const { name, value } = e.target;
      if (name && state.profile.hasOwnProperty(name)) {
        state.profile[name] = value;
        updateProfileUI();
      }
    });

    // 保存档案
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveProfileData();
    });
  }

  function updateProfileUI() {
    const { name, age, phone, address, medical } = state.profile;

    // 侧边栏
    const sideName = document.getElementById('sidebar-profile-name');
    const sidePhone = document.getElementById('sidebar-profile-phone');
    const sideAvatar = document.getElementById('sidebar-avatar');

    const avatarHtml = state.profile.avatar
      ? `<img src="${state.profile.avatar}" alt="头像" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : (name ? name.charAt(0) : '旅');

    if (sideName) sideName.textContent = name || '还没有档案';
    if (sidePhone) sidePhone.textContent = phone || '未填写联络手机';
    if (sideAvatar) sideAvatar.innerHTML = avatarHtml;

    // 档案面板预览卡
    const prevName = document.getElementById('profile-preview-name');
    const prevAge = document.getElementById('profile-preview-age');
    const prevPhone = document.getElementById('profile-preview-phone');
    const prevAddress = document.getElementById('profile-preview-address');
    const prevMedical = document.getElementById('profile-preview-medical');
    const prevAvatar = document.getElementById('profile-preview-avatar');

    if (prevName) prevName.textContent = name || '尚未设置姓名';
    if (prevAge) prevAge.textContent = age ? `${age} 岁` : '年龄待填';
    if (prevPhone) prevPhone.textContent = phone || '联系电话待填写';
    if (prevAddress) prevAddress.textContent = address || '国内常住住址待填写';
    if (prevMedical) prevMedical.textContent = medical || '医疗备注正常';
    if (prevAvatar) prevAvatar.innerHTML = avatarHtml;

    // 总览求助报文摘要
    const pName = document.getElementById('payload-name');
    const pLoc = document.getElementById('payload-location');
    const pContacts = document.getElementById('payload-contacts');

    if (pName) pName.textContent = name ? `${name} (${age || '--'}岁)` : '未填写姓名';
    if (pLoc) {
      pLoc.textContent = state.location.lat
        ? `${state.location.lat}, ${state.location.lng}`
        : '泰国曼谷基准点 (待授权GPS)';
    }
    const validCount = state.contacts.filter((c) => c.name.trim() && c.phone.trim()).length;
    if (pContacts) pContacts.textContent = `${validCount} 位联系人已同步`;

    updateReadinessScore();
    updateMyRadarMarker();
  }

  // ==========================================
  // 8. 紧急联系人动态增删改
  // ==========================================
  function initContactsManager() {
    const form = document.getElementById('contacts-form');
    const addBtn = document.getElementById('add-contact-btn');

    renderContacts();

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (state.contacts.length >= 5) {
          showToast('最多可添加 5 位紧急联系人', 'error');
          return;
        }

        state.contacts.push({
          id: Date.now().toString(),
          name: '',
          relation: '朋友 / 同行者',
          phone: '',
          isPrimary: false,
        });

        renderContacts();
        showToast('已新增联系人卡片，请填写信息');
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveContactsData();
      });
    }
  }

  function renderContacts() {
    const grid = document.getElementById('contacts-grid');
    const countEl = document.getElementById('contact-count');
    if (!grid) return;

    grid.innerHTML = '';

    const validCount = state.contacts.filter((c) => c.name.trim() && c.phone.trim()).length;
    if (countEl) countEl.textContent = `${validCount} / 5 已保存`;

    state.contacts.forEach((contact, index) => {
      const card = document.createElement('div');
      card.className = 'contact-card';
      card.innerHTML = `
        <div class="contact-card-header">
          <div class="contact-card-title">
            <span>#0${index + 1}</span>
            <strong>${contact.name || '新联系人'}</strong>
            ${contact.isPrimary ? '<span class="contact-badge-primary">第一顺位</span>' : ''}
          </div>
          ${
            state.contacts.length > 1
              ? `<button class="icon-button icon-button-subtle delete-contact-btn" type="button" data-index="${index}" title="删除联系人">
                   <i data-lucide="trash-2"></i>
                 </button>`
              : ''
          }
        </div>

        <div class="contact-inputs">
          <div class="contact-input-row">
            <input class="contact-input" type="text" placeholder="姓名 (如：父亲)" value="${escapeHtml(
              contact.name
            )}" data-field="name" data-index="${index}" required />
            <input class="contact-input" type="text" placeholder="关系 (如：家人)" value="${escapeHtml(
              contact.relation
            )}" data-field="relation" data-index="${index}" />
          </div>
          <input class="contact-input" type="tel" placeholder="电话号码 (+86 / +66)" value="${escapeHtml(
            contact.phone
          )}" data-field="phone" data-index="${index}" required />
        </div>

        <div class="contact-card-actions">
          <button type="button" class="text-button set-primary-btn" data-index="${index}">
            <i data-lucide="${contact.isPrimary ? 'star' : 'star-off'}"></i>
            <span>${contact.isPrimary ? '设为优先首要联系人' : '设为第一顺位'}</span>
          </button>
        </div>
      `;
      grid.appendChild(card);
    });

    // 绑定事件
    grid.querySelectorAll('.contact-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const idx = Number(e.target.getAttribute('data-index'));
        const field = e.target.getAttribute('data-field');
        if (state.contacts[idx] && field) {
          state.contacts[idx][field] = e.target.value;
          updateReadinessScore();
        }
      });
    });

    grid.querySelectorAll('.delete-contact-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = Number(btn.getAttribute('data-index'));
        if (state.contacts.length <= 1) {
          showToast('至少保留 1 位联系人', 'error');
          return;
        }
        state.contacts.splice(idx, 1);
        renderContacts();
        updateReadinessScore();
      });
    });

    grid.querySelectorAll('.set-primary-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-index'));
        state.contacts.forEach((c, i) => {
          c.isPrimary = i === idx;
        });
        renderContacts();
      });
    });

    initIcons();
  }

  // ==========================================
  // 9. SOS 一键报警与求助调度流程
  // ==========================================
  function getMyLiveTrackingUrl() {
    const myUsername = (state.user && state.user.username) || (state.profile.phone) || (state.profile.name) || 'guest';
    const cleanOrigin = window.location.origin;
    const cleanPath = window.location.pathname.replace(/\/+$/, '');
    const url = new URL(`${cleanOrigin}${cleanPath}/`);
    url.searchParams.set('track', myUsername);
    if (state.teamCode) {
      url.searchParams.set('room', state.teamCode);
    }
    return url.toString();
  }

  function generateSosPayloadText() {
    const { name, age, phone, address, passport, medical } = state.profile;
    const lat = state.location.lat || DEFAULT_BANGKOK.lat;
    const lng = state.location.lng || DEFAULT_BANGKOK.lng;
    const accuracy = state.location.accuracy || '估测';
    const googleMapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const liveTrackingUrl = getMyLiveTrackingUrl();

    const contactStr = state.contacts
      .filter((c) => c.name && c.phone)
      .map((c) => `${c.name}(${c.relation}): ${c.phone}`)
      .join('; ') || '未填写';

    return `【护途紧急求救 / THAILAND SOS】
求助人员: ${name || '中国公民'} (年龄: ${age || '--'}岁)
护照后四位: ${passport || '未备'}
本人联系电话: ${phone || '见本机'}
国内常住地址: ${address || '见护照/户籍'}
医疗/过敏说明: ${medical || '无特殊'}
当前定位坐标: ${lat}, ${lng} (误差范围 ±${accuracy}m)

🌐 护途专属实时动态追踪链接 (点击随时查看最新移动轨迹与相对距离):
${liveTrackingUrl}

📍 谷歌地图基准点 (备用导航):
${googleMapUrl}

国内紧急联系人: ${contactStr}
求救发出时间: ${new Date().toLocaleString('zh-CN')}
※ 提示：此求救信息由本人通过护途泰国安全中心生成，请点击实时追踪链接查看我的最新动态轨迹并协助报警！`;
  }

  function initEmergencyModal() {
    const alertBtn = document.getElementById('alert-button');
    const dockSosBtn = document.getElementById('mobile-dock-sos');
    const modal = document.getElementById('alert-modal');
    const closeBtn = document.getElementById('close-alert-modal');
    const modalContent = document.getElementById('alert-modal-content');
    const openPayloadBtn = document.getElementById('open-payload');

    function openSosModal() {
      const payloadText = generateSosPayloadText();

      // 触感震动 (移动设备)
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }

      if (modalContent) {
        modalContent.innerHTML = `
          <div class="modal-alert-box">
            <strong><i data-lucide="siren"></i> 确认启动紧急求助流程？</strong>
            <p>已自动打包当前 GPS 定位与个人身份档案，并生成了<b>包含本站专属实时动态追踪链接</b>的结构化报文，亲友打开链接即可实时查看你的最新移动轨迹。</p>
          </div>

          <div style="margin-bottom: 0.85rem; font-size: 0.8rem; color: var(--text-muted);">
            <span>自动生成的结构化求救报文预览：</span>
          </div>

          <pre class="modal-payload-box">${escapeHtml(payloadText)}</pre>

          <div class="modal-actions">
            <button id="modal-copy-btn" class="button button-primary button-full" type="button">
              <i data-lucide="copy"></i>
              <span>一键复制完整求助报文 (含实时动态追踪链接)</span>
            </button>

            <button id="modal-copy-track-btn" class="button button-secondary button-full" type="button" style="border-color: rgba(16, 185, 129, 0.4); color: var(--emerald-400);">
              <i data-lucide="share-2"></i>
              <span>仅复制我的专属实时追踪网址链接 (发微信/群聊)</span>
            </button>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem;">
              <a href="tel:191" class="button button-secondary" style="border-color: rgba(239, 68, 68, 0.4); color: var(--crimson-400);">
                <i data-lucide="phone"></i>
                <span>拨打 191 (警方)</span>
              </a>
              <a href="tel:1155" class="button button-secondary" style="border-color: rgba(59, 130, 246, 0.4); color: var(--blue-400);">
                <i data-lucide="languages"></i>
                <span>拨打 1155 (中文)</span>
              </a>
            </div>

            <a href="tel:+6622457010" class="button button-outline button-full">
              <i data-lucide="landmark"></i>
              <span>直拨中国驻泰使馆领保 (+66 2 245 7010)</span>
            </a>
          </div>
        `;
      }

      modal.removeAttribute('hidden');
      initIcons();

      // 绑定复制按钮
      const copyBtn = document.getElementById('modal-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          copyToClipboard(payloadText, '求助完整报文已复制至剪贴板，可直接粘贴发微信或短信！');
        });
      }

      const copyTrackBtn = document.getElementById('modal-copy-track-btn');
      if (copyTrackBtn) {
        copyTrackBtn.addEventListener('click', () => {
          const liveUrl = getMyLiveTrackingUrl();
          const shareMsg = `【护途实时定位追踪】我正在泰国行程中，请通过此链接实时查看我的最新移动轨迹与相对距离：\n${liveUrl}`;
          copyToClipboard(shareMsg, '专属实时动态追踪链接已复制，可直接发给亲友或微信群！');
        });
      }
    }

    if (alertBtn) alertBtn.addEventListener('click', openSosModal);
    if (dockSosBtn) dockSosBtn.addEventListener('click', openSosModal);

    if (openPayloadBtn) {
      openPayloadBtn.addEventListener('click', () => {
        copyToClipboard(generateSosPayloadText());
      });
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => {
        modal.setAttribute('hidden', '');
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.setAttribute('hidden', '');
        }
      });
    }
  }

  // ==========================================
  // 10. 安全设置与数据清空
  // ==========================================
  function initSettingsView() {
    const clearBtn = document.getElementById('clear-data');
    const locToggle = document.getElementById('settings-location-toggle');

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('确认清除本机的全部档案、联系人和定位记录吗？此操作无法撤销。')) {
          localStorage.removeItem(STORAGE_KEYS.PROFILE);
          localStorage.removeItem(STORAGE_KEYS.CONTACTS);
          localStorage.removeItem(STORAGE_KEYS.LAST_LOCATION);

          state.profile = {
            name: '',
            age: '',
            phone: '',
            address: '',
            passport: '',
            medical: '',
          };
          state.contacts = [
            {
              id: '1',
              name: '紧急联系人1',
              relation: '直系亲属',
              phone: '',
              isPrimary: true,
            },
          ];
          state.location = {
            lat: null,
            lng: null,
            accuracy: null,
            updated: null,
            granted: false,
          };

          // 重置表单
          const pForm = document.getElementById('profile-form');
          if (pForm) pForm.reset();

          renderContacts();
          updateAllViews();
          showToast('本地所有加密数据已彻底抹除');
        }
      });
    }

    if (locToggle) {
      locToggle.addEventListener('click', () => {
        const isChecked = locToggle.getAttribute('aria-checked') === 'true';
        locToggle.setAttribute('aria-checked', (!isChecked).toString());
        if (!isChecked) {
          requestGeolocation(true);
        } else {
          state.location.granted = false;
          updateLocationUI();
          showToast('已关闭实时定位权限');
        }
      });
    }
  }

  // ==========================================
  // 用户鉴权系统 (支持登录/注册选项卡、密码可见性切换、个人中心)
  // ==========================================
  function bindPasswordToggle(toggleBtnId, inputId) {
    const btn = document.getElementById(toggleBtnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isPwd = input.type === 'password';
      input.type = isPwd ? 'text' : 'password';
      btn.innerHTML = `<i data-lucide="${isPwd ? 'eye-off' : 'eye'}"></i>`;
      btn.setAttribute('title', isPwd ? '隐藏密码' : '显示密码');
      initIcons();
    });
  }

  function initAuthSystem() {
    const userBtn = document.getElementById('top-user-btn');
    const authModal = document.getElementById('auth-modal');
    const closeAuthBtn = document.getElementById('close-auth-modal');
    const userCenterModal = document.getElementById('user-center-modal');
    const closeUserCenterBtn = document.getElementById('close-user-center-modal');

    // 绑定密码眼睛显示/隐藏切换
    bindPasswordToggle('toggle-login-pwd-btn', 'login-password');
    bindPasswordToggle('toggle-reg-pwd-btn', 'reg-password');
    bindPasswordToggle('toggle-reg-confirm-pwd-btn', 'reg-confirm-password');

    // 彻底清除临时访客/行者历史残留（未登录用户保持 null）
    if (state.user && state.user.id && (state.user.id.startsWith('user_guest') || (state.user.name && state.user.name.startsWith('行者')))) {
      state.user = null;
      state.token = null;
      try {
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
        localStorage.removeItem(STORAGE_KEYS.LAST_LOCATION);
      } catch (e) {}
    }

    updateAuthUI();

    // 选项卡切换控制
    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const formLogin = document.getElementById('auth-login-form');
    const formRegister = document.getElementById('auth-register-form');
    const switchToRegBtn = document.getElementById('login-switch-to-register');
    const switchToLoginBtn = document.getElementById('register-switch-to-login');

    function setAuthTab(tab) {
      if (tab === 'login') {
        tabLogin?.classList.add('active');
        tabLogin?.setAttribute('aria-selected', 'true');
        tabRegister?.classList.remove('active');
        tabRegister?.setAttribute('aria-selected', 'false');
        formLogin?.removeAttribute('hidden');
        formRegister?.setAttribute('hidden', '');
        setTimeout(() => document.getElementById('login-username')?.focus(), 50);
      } else {
        tabRegister?.classList.add('active');
        tabRegister?.setAttribute('aria-selected', 'true');
        tabLogin?.classList.remove('active');
        tabLogin?.setAttribute('aria-selected', 'false');
        formRegister?.removeAttribute('hidden');
        formLogin?.setAttribute('hidden', '');
        setTimeout(() => document.getElementById('reg-username')?.focus(), 50);
      }
    }

    if (tabLogin) tabLogin.addEventListener('click', () => setAuthTab('login'));
    if (tabRegister) tabRegister.addEventListener('click', () => setAuthTab('register'));
    if (switchToRegBtn) switchToRegBtn.addEventListener('click', () => setAuthTab('register'));
    if (switchToLoginBtn) switchToLoginBtn.addEventListener('click', () => setAuthTab('login'));

    // 顶栏用户胶囊点击：根据登录态智能弹出「个人中心」或「登录/注册」
    if (userBtn) {
      userBtn.addEventListener('click', () => {
        const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
        if (isLoggedIn) {
          updateUserCenterUI();
          if (userCenterModal) userCenterModal.removeAttribute('hidden');
        } else {
          setAuthTab('login');
          if (authModal) authModal.removeAttribute('hidden');
        }
      });
    }

    // 关闭登录弹窗
    if (closeAuthBtn && authModal) {
      closeAuthBtn.addEventListener('click', () => authModal.setAttribute('hidden', ''));
      authModal.addEventListener('click', (e) => {
        if (e.target === authModal) authModal.setAttribute('hidden', '');
      });
    }

    // 关闭用户中心弹窗
    if (closeUserCenterBtn && userCenterModal) {
      closeUserCenterBtn.addEventListener('click', () => userCenterModal.setAttribute('hidden', ''));
      userCenterModal.addEventListener('click', (e) => {
        if (e.target === userCenterModal) userCenterModal.setAttribute('hidden', '');
      });
    }

    // 用户中心内部按钮操作
    const ucEditProfileBtn = document.getElementById('uc-edit-profile-btn');
    if (ucEditProfileBtn) {
      ucEditProfileBtn.addEventListener('click', () => {
        userCenterModal?.setAttribute('hidden', '');
        const profileNavBtn = document.querySelector('[data-view="profile"]');
        if (profileNavBtn) profileNavBtn.click();
      });
    }

    const ucSwitchTeamBtn = document.getElementById('uc-switch-team-btn');
    if (ucSwitchTeamBtn) {
      ucSwitchTeamBtn.addEventListener('click', () => {
        userCenterModal?.setAttribute('hidden', '');
        openTeamModal();
      });
    }

    const ucLogoutBtn = document.getElementById('uc-logout-btn');
    if (ucLogoutBtn) {
      ucLogoutBtn.addEventListener('click', () => {
        performLogout();
      });
    }



    // 登录表单提交
    if (formLogin) {
      formLogin.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username')?.value.trim();
        const password = document.getElementById('login-password')?.value.trim();
        const remember = document.getElementById('login-remember')?.checked ?? true;
        submitLogin(username, password, remember);
      });
    }

    // 注册表单提交
    if (formRegister) {
      formRegister.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username')?.value.trim();
        const name = document.getElementById('reg-name')?.value.trim();
        const password = document.getElementById('reg-password')?.value.trim();
        const confirmPassword = document.getElementById('reg-confirm-password')?.value.trim();
        const phone = document.getElementById('reg-phone')?.value.trim();

        if (password !== confirmPassword) {
          showToast('两次输入的密码不一致，请核对后重新输入', 'error');
          document.getElementById('reg-confirm-password')?.focus();
          return;
        }

        submitRegister(username, password, name, phone);
      });
    }

    // 按 ESC 键关闭弹窗
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        authModal?.setAttribute('hidden', '');
        userCenterModal?.setAttribute('hidden', '');
      }
    });
  }

  function submitLogin(username, password, remember = true) {
    const authModal = document.getElementById('auth-modal');
    const submitBtn = document.getElementById('login-submit-btn');

    if (!username || !password) {
      showToast('请输入完整的账号与密码', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i><span>登录验证中...</span>`;
      initIcons();
    }

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          state.user = data.user;
          state.token = data.token;

          if (remember) {
            try {
              localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
              localStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(data.user));
            } catch (e) {}
          }

          if (data.user.name && !state.profile.name) {
            state.profile.name = data.user.name;
            saveProfileData();
          }

          authModal?.setAttribute('hidden', '');
          updateAuthUI();
          updateAllViews();

          // 登录成功后正式开启高精定位与位置上报
          requestGeolocation(false);
          fetchIpLocationFallback();
          reportMyLocation();
          fetchTeamMembers();

          showToast(`登录成功！欢迎同行成员【${data.user.name || data.user.username}】`);
        } else {
          showToast(data.message || '登录失败，请检查账号密码', 'error');
        }
      })
      .catch((err) => {
        showToast('登录接口网络异常: ' + err.message, 'error');
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<i data-lucide="log-in"></i><span>立即安全登录</span>`;
          initIcons();
        }
      });
  }

  function submitRegister(username, password, name, phone) {
    const authModal = document.getElementById('auth-modal');
    const submitBtn = document.getElementById('reg-submit-btn');

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i><span>注册创建中...</span>`;
      initIcons();
    }

    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name, phone }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          state.user = data.user;
          state.token = data.token;

          try {
            localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
            localStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(data.user));
          } catch (e) {}

          if (name) {
            state.profile.name = name;
          }
          if (phone) {
            state.profile.phone = phone;
          }
          saveProfileData();

          authModal?.setAttribute('hidden', '');
          updateAuthUI();
          updateAllViews();

          // 注册成功后正式开启高精定位与位置上报
          requestGeolocation(false);
          fetchIpLocationFallback();
          reportMyLocation();
          fetchTeamMembers();

          showToast(`🎉 注册成功！欢迎加入同行小队：【${data.user.name}】`);
        } else {
          showToast(data.message || '注册失败，请稍后重试', 'error');
        }
      })
      .catch((err) => {
        showToast('注册接口异常: ' + err.message, 'error');
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<i data-lucide="user-plus"></i><span>完成注册并加入同行小队</span>`;
          initIcons();
        }
      });
  }

  function performLogout() {
    const userCenterModal = document.getElementById('user-center-modal');

    // 远程注销会话
    if (state.token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.token}`,
        },
      }).catch(() => {});
    }

    // 本地清除登录态
    state.token = null;
    state.user = null;
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
      localStorage.removeItem(STORAGE_KEYS.LAST_LOCATION);
    } catch (e) {}

    // 未登录彻底清除定位数据与地图标点，未登录无定位
    state.location = {
      lat: null,
      lng: null,
      accuracy: null,
      updated: null,
      granted: false,
      city: '',
    };
    if (state.marker && state.map) {
      state.map.removeLayer(state.marker);
      state.marker = null;
    }
    if (state.radarMarker && state.radarMap) {
      state.radarMap.removeLayer(state.radarMarker);
      state.radarMarker = null;
    }

    userCenterModal?.setAttribute('hidden', '');
    updateAuthUI();
    updateLocationUI();
    updateAllViews();

    showToast('已安全退出当前账号，未登录状态下不开启定位与共享');
  }

  function updateUserCenterUI() {
    if (!state.user) return;
    const ucAvatar = document.getElementById('uc-avatar');
    const ucName = document.getElementById('uc-name');
    const ucUsername = document.getElementById('uc-username');
    const ucTeam = document.getElementById('uc-team-code');
    const ucPhone = document.getElementById('uc-phone');

    if (ucName) ucName.textContent = state.user.name || state.profile.name || '同行旅行者';
    if (ucUsername) ucUsername.textContent = `#${state.user.username || '--'}`;
    if (ucTeam) ucTeam.textContent = `#${state.teamCode || '666888'}`;
    if (ucPhone) ucPhone.textContent = state.user.phone || state.profile.phone || '未公开';

    if (ucAvatar) {
      const avatarUrl = state.profile.avatar || state.user.avatar;
      if (avatarUrl) {
        ucAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar">`;
      } else {
        const initial = (state.user.name || state.user.username || '用').charAt(0);
        ucAvatar.textContent = initial;
      }
    }
  }

  function updateAuthUI() {
    const topAvatar = document.getElementById('top-user-avatar');
    const topName = document.getElementById('top-user-name');
    const userPill = document.getElementById('top-user-btn');

    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));

    if (userPill) {
      userPill.setAttribute('title', isLoggedIn ? '点击打开同行个人中心' : '点击登录或注册同行账号');
    }

    if (topName) {
      if (isLoggedIn) {
        topName.textContent = state.user.name || `#${state.user.username}`;
      } else {
        topName.textContent = '登录 / 注册';
      }
    }

    if (topAvatar) {
      if (state.profile.avatar || (state.user && state.user.avatar)) {
        topAvatar.innerHTML = `<img src="${state.profile.avatar || state.user.avatar}" alt="Avatar">`;
      } else if (state.user && state.user.name && isLoggedIn) {
        topAvatar.textContent = state.user.name.charAt(0);
      } else {
        topAvatar.textContent = '登';
      }
    }

    updateUserCenterUI();
    updateMyRadarMarker();
  }

  // ==========================================
  // 6. 独立雷达全屏地图与头像标点驱动
  // ==========================================
  function getMyAvatarHtml() {
    const avatarUrl = state.profile.avatar || (state.user && state.user.avatar) || '';
    const myName = state.profile.name || (state.user && state.user.name) || (state.user && state.user.username) || '我';
    const initial = myName.charAt(0);
    return avatarUrl
      ? `<img src="${avatarUrl}" alt="${escapeHtml(myName)}">`
      : escapeHtml(initial);
  }

  function createMyRadarIcon() {
    const avatarHtml = getMyAvatarHtml();
    const myName = state.profile.name || (state.user && state.user.name) || '我';
    const html = `
      <div class="radar-avatar-marker is-me">
        <div class="radar-avatar-pulse"></div>
        <div class="radar-avatar-bubble">
          <span>${escapeHtml(myName)}</span>
          <span class="avatar-role-tag">(我)</span>
        </div>
        <div class="radar-avatar-ring">
          ${avatarHtml}
        </div>
        <div class="radar-avatar-pointer"></div>
      </div>
    `;
    return L.divIcon({
      className: 'radar-avatar-leaflet-marker',
      html: html,
      iconSize: [42, 48],
      iconAnchor: [21, 48],
      popupAnchor: [0, -48],
    });
  }

  function updateMyRadarMarker() {
    if (!state.radarMap || !window.L) return;
    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
    if (!isLoggedIn || !state.location.granted || state.location.lat === null || state.location.lng === null) {
      if (state.radarMarker) {
        state.radarMap.removeLayer(state.radarMarker);
        state.radarMarker = null;
      }
      return;
    }

    const myLat = state.location.lat;
    const myLng = state.location.lng;
    const disp = toMapCoordinate(myLat, myLng);

    const icon = createMyRadarIcon();
    const myName = state.profile.name || (state.user && state.user.name) || '我';

    if (!state.radarMarker) {
      state.radarMarker = L.marker([disp.lat, disp.lng], { icon, zIndexOffset: 1000 }).addTo(state.radarMap);
      state.radarMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        applyManualCalibration(pos.lat, pos.lng);
      });
    } else {
      state.radarMarker.setIcon(icon);
      state.radarMarker.setLatLng([disp.lat, disp.lng]);
    }

    const locSource = state.location.source === 'amap'
      ? '高德开放平台高精定位'
      : (state.location.source === 'manual' ? '手动精细校准' : '系统 GPS 定位');

    state.radarMarker.bindPopup(`
      <div style="font-size: 0.85rem; padding: 4px;">
        <strong style="display:block;margin-bottom:2px;color:var(--blue-400);">我的当前位置 (${escapeHtml(myName)})</strong>
        <div style="color:#64748b;font-size:0.75rem;margin:2px 0;">坐标: ${myLat.toFixed(4)}, ${myLng.toFixed(4)}</div>
        <div style="color:#10b981;font-size:0.75rem;">定位来源: ${locSource} (±${state.location.accuracy || 20}m)</div>
        ${state.location.address ? `<div style="color:#94a3b8;font-size:0.72rem;margin-top:2px;">位置: ${escapeHtml(state.location.address)}</div>` : ''}
      </div>
    `);
  }

  function initRadarMap() {
    const radarContainer = document.getElementById('radar-fullscreen-map');
    if (!radarContainer || !window.L) return;

    const initialLat = state.location.lat || DEFAULT_BANGKOK.lat;
    const initialLng = state.location.lng || DEFAULT_BANGKOK.lng;

    // 若当前坐标在泰国/海外，且当前底图为高德（高德海外为空白），自动智能采用全球线图 OSM
    if (!isChinaCoordinate(initialLng, initialLat) && (state.currentMapSource === 'amap' || state.currentMapSource === 'sat')) {
      state.currentMapSource = 'osm';
    }

    const disp = toMapCoordinate(initialLat, initialLng);

    state.radarMap = L.map('radar-fullscreen-map', {
      zoomControl: true,
      attributionControl: false,
    }).setView([disp.lat, disp.lng], 13);

    // 加载纯净无水印底图
    state.radarTileLayer = createTileLayer(state.currentMapSource).addTo(state.radarMap);

    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
    if (isLoggedIn && state.location.granted) {
      updateMyRadarMarker();
    }

    // 绑定雷达工具栏操作
    const locateMeBtn = document.getElementById('radar-locate-me-btn');
    if (locateMeBtn) {
      locateMeBtn.addEventListener('click', () => {
        const isLogged = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
        if (!isLogged || !state.location.granted || state.location.lat === null) {
          showToast('未登录状态无定位数据，请先登录账号', 'warning');
          const authModal = document.getElementById('auth-modal');
          authModal?.removeAttribute('hidden');
          return;
        }
        const myLat = state.location.lat;
        const myLng = state.location.lng;
        const targetDisp = toMapCoordinate(myLat, myLng);
        state.radarMap?.flyTo([targetDisp.lat, targetDisp.lng], 15);
        showToast('已聚焦至我的当前位置');
      });
    }

    // 绑定定位微调校准功能
    const calibrateBtn = document.getElementById('radar-calibrate-btn');
    const calibrateBtnText = document.getElementById('radar-calibrate-btn-text');
    let isCalibrating = false;

    if (calibrateBtn) {
      calibrateBtn.addEventListener('click', () => {
        const isLogged = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
        if (!isLogged || !state.location.granted) {
          showToast('未登录状态无法校准定位，请先登录账号', 'warning');
          const authModal = document.getElementById('auth-modal');
          authModal?.removeAttribute('hidden');
          return;
        }
        isCalibrating = !isCalibrating;
        if (isCalibrating) {
          calibrateBtn.classList.remove('button-outline');
          calibrateBtn.classList.add('button-primary');
          if (calibrateBtnText) calibrateBtnText.textContent = '完成校准';

          if (state.radarMarker && state.radarMarker.dragging) {
            state.radarMarker.dragging.enable();
          }

          showToast('已进入微调校准模式：可拖拽头像图钉，或直接在地图上点击任意位置进行校准！');
        } else {
          calibrateBtn.classList.add('button-outline');
          calibrateBtn.classList.remove('button-primary');
          if (calibrateBtnText) calibrateBtnText.textContent = '微调校准';

          if (state.radarMarker && state.radarMarker.dragging) {
            state.radarMarker.dragging.disable();
          }

          showToast('微调校准已锁定完成！');
        }
      });
    }

    state.radarMap.on('click', (e) => {
      if (isCalibrating) {
        applyManualCalibration(e.latlng.lat, e.latlng.lng);
      }
    });

    const fitBoundsBtn = document.getElementById('radar-fit-bounds-btn');
    if (fitBoundsBtn) {
      fitBoundsBtn.addEventListener('click', () => {
        fitAllMembers(state.radarMap);
      });
    }

    const refreshGpsBtn = document.getElementById('radar-refresh-gps-btn');
    if (refreshGpsBtn) {
      refreshGpsBtn.addEventListener('click', () => {
        requestGeolocation(true);
      });
    }

    // 绑定顶部创建/切换房间按钮
    const openRoomModalBtn = document.getElementById('radar-open-room-modal-btn');
    if (openRoomModalBtn) {
      openRoomModalBtn.addEventListener('click', () => {
        openTeamModal();
      });
    }

    // 绑定在线成员药丸胶囊按钮与浮层展开/收起
    const rosterPillBtn = document.getElementById('radar-roster-pill-btn');
    const rosterPopover = document.getElementById('radar-roster-popover');
    const closePopoverBtn = document.getElementById('radar-close-popover-btn');
    const collapsePopoverBtn = document.getElementById('radar-collapse-popover-btn');

    if (rosterPillBtn && rosterPopover) {
      function setRosterOpen(open) {
        if (open) {
          rosterPopover.removeAttribute('hidden');
          rosterPillBtn.classList.add('active');
          rosterPillBtn.setAttribute('aria-expanded', 'true');
        } else {
          rosterPopover.setAttribute('hidden', '');
          rosterPillBtn.classList.remove('active');
          rosterPillBtn.setAttribute('aria-expanded', 'false');
        }
      }

      rosterPillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCurrentlyHidden = rosterPopover.hasAttribute('hidden');
        setRosterOpen(isCurrentlyHidden);
      });

      if (closePopoverBtn) {
        closePopoverBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          setRosterOpen(false);
        });
      }

      if (collapsePopoverBtn) {
        collapsePopoverBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          setRosterOpen(false);
        });
      }

      // 点击浮层以外任意区域自动收起
      document.addEventListener('click', (e) => {
        if (!rosterPopover.hasAttribute('hidden')) {
          const wrapper = document.querySelector('.radar-roster-dropdown-wrapper');
          if (wrapper && !wrapper.contains(e.target)) {
            setRosterOpen(false);
          }
        }
      });

      // 按下 ESC 键安全收起
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !rosterPopover.hasAttribute('hidden')) {
          setRosterOpen(false);
        }
      });
    }

    // 绑定复制实时追踪分享链接按钮
    const copyInviteBtn = document.getElementById('radar-copy-invite-btn');
    if (copyInviteBtn) {
      copyInviteBtn.addEventListener('click', () => {
        const liveTrackingUrl = getMyLiveTrackingUrl();
        const shareText = `【护途实时动态定位追踪】我正在泰国行程中共享实时位置！点击专属追踪链接，可随时在卫星地图上查看我的最新移动动态并计算相对距离：\n${liveTrackingUrl}`;
        copyToClipboard(shareText, '专属实时动态追踪链接已复制，可直接发给亲友或微信群！');
      });
    }

    // 绑定底图切换按钮与弹出面板
    const layerToggleBtn = document.getElementById('radar-layer-toggle-btn');
    const layerPopover = document.getElementById('radar-layer-popover');

    if (layerToggleBtn && layerPopover) {
      function setLayerPopoverOpen(open) {
        if (open) {
          layerPopover.removeAttribute('hidden');
          layerToggleBtn.classList.add('active');
          layerToggleBtn.setAttribute('aria-expanded', 'true');
        } else {
          layerPopover.setAttribute('hidden', '');
          layerToggleBtn.classList.remove('active');
          layerToggleBtn.setAttribute('aria-expanded', 'false');
        }
      }

      layerToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = layerPopover.hasAttribute('hidden');
        setLayerPopoverOpen(isHidden);
      });

      const layerItems = layerPopover.querySelectorAll('.radar-layer-item');
      layerItems.forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const layerId = item.getAttribute('data-layer-id');
          if (layerId) {
            switchMapSource(layerId);
            setLayerPopoverOpen(false);
          }
        });
      });

      // 点击外部区域自动收起
      document.addEventListener('click', (e) => {
        if (!layerPopover.hasAttribute('hidden')) {
          const wrapper = document.querySelector('.radar-layer-dropdown-wrapper');
          if (wrapper && !wrapper.contains(e.target)) {
            setLayerPopoverOpen(false);
          }
        }
      });

      // 按 ESC 键快速关闭
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !layerPopover.hasAttribute('hidden')) {
          setLayerPopoverOpen(false);
        }
      });
    }

    // 默认高德线图状态初始化
    switchMapSource(state.currentMapSource, false);

    // 自动监听容器尺寸变化（支持页面加载、面板切换、窗口调整自适应渲染瓦片）
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => {
        if (state.radarMap && radarContainer.offsetWidth > 0 && radarContainer.offsetHeight > 0) {
          state.radarMap.invalidateSize();
        }
      });
      resizeObserver.observe(radarContainer);
    }
  }

  // ==========================================
  // 10. 多人小队雷达与实时位置共享生命周期体系
  // ==========================================
  function openTeamModal(cleanForNew = false) {
    const teamModal = document.getElementById('team-modal');
    const input = document.getElementById('team-code-input');
    if (input) {
      input.value = cleanForNew ? '' : (state.teamCode || '');
      setTimeout(() => {
        input.focus();
        input.select();
      }, 80);
    }
    if (teamModal) teamModal.removeAttribute('hidden');
  }

  function initTeamSystem() {
    const switchBtn = document.getElementById('switch-team-btn');
    const teamModal = document.getElementById('team-modal');
    const closeTeamBtn = document.getElementById('close-team-modal');
    const teamForm = document.getElementById('team-form');

    // 随机房间号生成按钮
    const randomCodeBtn = document.getElementById('team-code-random-btn');
    if (randomCodeBtn) {
      randomCodeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = document.getElementById('team-code-input');
        const randNum = Math.floor(1000 + Math.random() * 9000);
        const randCode = `TH${randNum}`;
        if (input) {
          input.value = randCode;
          input.focus();
          input.select();
        }
        showToast(`已生成专属房间号 #${randCode}，点击确认即可创建并成为房主！`);
      });
    }

    // 退出小队与解散小队交互绑定
    const radarLeaveBtn = document.getElementById('radar-leave-room-btn');
    const radarDisbandBtn = document.getElementById('radar-disband-room-btn');
    const modalLeaveBtn = document.getElementById('team-modal-leave-btn');
    const modalDisbandBtn = document.getElementById('team-modal-disband-btn');
    const ucLeaveBtn = document.getElementById('uc-leave-team-btn');

    if (radarLeaveBtn) radarLeaveBtn.addEventListener('click', leaveTeamRoom);
    if (radarDisbandBtn) radarDisbandBtn.addEventListener('click', disbandTeamRoom);
    if (modalLeaveBtn) modalLeaveBtn.addEventListener('click', leaveTeamRoom);
    if (modalDisbandBtn) modalDisbandBtn.addEventListener('click', disbandTeamRoom);
    if (ucLeaveBtn) ucLeaveBtn.addEventListener('click', leaveTeamRoom);

    updateRoomBadgesUI();

    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        openTeamModal();
      });
    }

    if (closeTeamBtn && teamModal) {
      closeTeamBtn.addEventListener('click', () => {
        teamModal.setAttribute('hidden', '');
      });
      teamModal.addEventListener('click', (e) => {
        if (e.target === teamModal) teamModal.setAttribute('hidden', '');
      });
    }

    if (teamForm) {
      teamForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('team-code-input');
        const code = input ? input.value.trim() : '';
        if (switchTeamRoom(code)) {
          if (teamModal) teamModal.setAttribute('hidden', '');
        }
      });
    }

    // 初始立即上报一次位置并拉取小队全员
    setTimeout(() => {
      reportMyLocation();
      fetchTeamMembers();
    }, 800);

    // 每 4 秒自动心跳同步小队雷达
    setInterval(() => {
      reportMyLocation();
      fetchTeamMembers();
    }, 4000);
  }

  function updateRoomBadgesUI() {
    const overviewBadge = document.getElementById('team-room-code-badge');
    const radarBadge = document.getElementById('radar-room-badge');
    const ucTeam = document.getElementById('uc-team-code');
    const ucLeaveBtn = document.getElementById('uc-leave-team-btn');

    // 雷达花名册操作栏元素
    const rosterBar = document.getElementById('roster-room-manage-bar');
    const rosterRolePill = document.getElementById('radar-room-role-pill');
    const rosterRoleText = document.getElementById('radar-room-role-text');
    const rosterCodeTag = document.getElementById('radar-room-code-tag');
    const rosterLeaveBtn = document.getElementById('radar-leave-room-btn');
    const rosterDisbandBtn = document.getElementById('radar-disband-room-btn');

    // 模态窗当前小队卡片
    const modalCurrentCard = document.getElementById('team-modal-current-card');
    const modalCurrCode = document.getElementById('team-modal-curr-code');
    const modalCurrRole = document.getElementById('team-modal-curr-role');
    const modalLeaveBtn = document.getElementById('team-modal-leave-btn');
    const modalDisbandBtn = document.getElementById('team-modal-disband-btn');

    const hasTeam = Boolean(state.teamCode && state.teamCode.trim().length > 0);

    if (hasTeam) {
      if (overviewBadge) overviewBadge.textContent = `房间号 #${state.teamCode}`;
      if (radarBadge) radarBadge.innerHTML = `<i data-lucide="hash"></i> 房间号 #${state.teamCode}`;
      if (ucTeam) ucTeam.textContent = `#${state.teamCode}`;
      if (ucLeaveBtn) ucLeaveBtn.style.display = 'inline-flex';

      if (rosterBar) rosterBar.style.display = 'flex';
      if (rosterCodeTag) rosterCodeTag.textContent = `#${state.teamCode}`;
      if (rosterRoleText) rosterRoleText.textContent = state.isRoomOwner ? '房主' : '队员';
      if (rosterRolePill) {
        rosterRolePill.className = state.isRoomOwner ? 'room-role-pill is-owner' : 'room-role-pill';
        rosterRolePill.innerHTML = state.isRoomOwner
          ? '<i data-lucide="crown"></i> 房主'
          : '<i data-lucide="shield"></i> 队员';
      }
      if (rosterLeaveBtn) rosterLeaveBtn.style.display = 'inline-flex';
      if (rosterDisbandBtn) rosterDisbandBtn.style.display = state.isRoomOwner ? 'inline-flex' : 'none';

      if (modalCurrentCard) modalCurrentCard.style.display = 'flex';
      if (modalCurrCode) modalCurrCode.textContent = `#${state.teamCode}`;
      if (modalCurrRole) {
        modalCurrRole.className = state.isRoomOwner ? 'room-role-pill is-owner' : 'room-role-pill';
        modalCurrRole.innerHTML = state.isRoomOwner
          ? '<i data-lucide="crown"></i> 房主'
          : '<i data-lucide="shield"></i> 队员';
      }
      if (modalLeaveBtn) modalLeaveBtn.style.display = 'inline-flex';
      if (modalDisbandBtn) modalDisbandBtn.style.display = state.isRoomOwner ? 'inline-flex' : 'none';
    } else {
      if (overviewBadge) overviewBadge.textContent = '单人独立守护模式';
      if (radarBadge) radarBadge.innerHTML = '<i data-lucide="shield"></i> 单人守护模式';
      if (ucTeam) ucTeam.textContent = '未加入小队 (个人模式)';
      if (ucLeaveBtn) ucLeaveBtn.style.display = 'none';

      if (rosterBar) rosterBar.style.display = 'none';
      if (modalCurrentCard) modalCurrentCard.style.display = 'none';
    }

    initIcons();
  }

  function switchTeamRoom(code) {
    if (!code || code.length < 2) {
      showToast('房间号至少需2位字符（支持数字、字母如 666888 或 TH888）', 'error');
      return false;
    }

    state.teamCode = code;
    try {
      localStorage.setItem(STORAGE_KEYS.TEAM_CODE, code);
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.set('room', code);
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {}

    updateRoomBadgesUI();

    // 清空两处地图上的旧队友图钉
    state.overviewTeamMarkers.forEach((m) => state.map?.removeLayer(m));
    state.overviewTeamMarkers.clear();

    state.radarTeamMarkers.forEach((m) => state.radarMap?.removeLayer(m));
    state.radarTeamMarkers.clear();

    reportMyLocation();
    fetchTeamMembers();
    showToast(`已切换至房间 #${code}，雷达全员同步中！`);
    return true;
  }

  function leaveTeamRoom() {
    if (!state.teamCode) return;
    const room = state.teamCode;
    const ok = confirm(`确定要退出当前小队房间【#${room}】吗？\n退出后其他队员将无法在雷达上查看您的实时动态。`);
    if (!ok) return;

    fetch('/api/team/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamCode: room,
        userId: state.user?.id || '',
      }),
    }).catch(() => {});

    state.teamCode = '';
    try {
      localStorage.setItem(STORAGE_KEYS.TEAM_CODE, '');
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {}

    state.teamMembers = [];
    state.roomOwnerId = '';
    state.roomOwnerName = '';
    state.isRoomOwner = false;

    // 清空地图图钉
    state.overviewTeamMarkers.forEach((m) => state.map?.removeLayer(m));
    state.overviewTeamMarkers.clear();
    state.radarTeamMarkers.forEach((m) => state.radarMap?.removeLayer(m));
    state.radarTeamMarkers.clear();

    updateRoomBadgesUI();
    renderTeamMembersUI();
    updateTeamMapMarkers();

    const teamModal = document.getElementById('team-modal');
    if (teamModal) teamModal.setAttribute('hidden', '');

    showToast(`已成功退出小队 #${room}，当前处于单人独立守护模式！`);
  }

  function disbandTeamRoom() {
    if (!state.teamCode) return;
    const room = state.teamCode;
    const ok = confirm(`⚠️ 警告：解散后小队房间【#${room}】将被彻底关闭，所有在线队员都将被移出小队并停止雷达同步！\n\n确定要解散该房间吗？`);
    if (!ok) return;

    fetch('/api/team/disband', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamCode: room,
        operatorUserId: state.user?.id || '',
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          state.teamCode = '';
          try {
            localStorage.setItem(STORAGE_KEYS.TEAM_CODE, '');
            const url = new URL(window.location.href);
            if (url.searchParams.has('room')) {
              url.searchParams.delete('room');
              window.history.replaceState({}, '', url.toString());
            }
          } catch (e) {}

          state.teamMembers = [];
          state.roomOwnerId = '';
          state.roomOwnerName = '';
          state.isRoomOwner = false;

          state.overviewTeamMarkers.forEach((m) => state.map?.removeLayer(m));
          state.overviewTeamMarkers.clear();
          state.radarTeamMarkers.forEach((m) => state.radarMap?.removeLayer(m));
          state.radarTeamMarkers.clear();

          updateRoomBadgesUI();
          renderTeamMembersUI();
          updateTeamMapMarkers();

          const teamModal = document.getElementById('team-modal');
          if (teamModal) teamModal.setAttribute('hidden', '');

          showToast(`小队房间 #${room} 已成功解散！`);
        } else {
          showToast(data.message || '解散失败', 'error');
        }
      })
      .catch((err) => {
        showToast('解散接口请求失败: ' + err.message, 'error');
      });
  }

  function kickTeamMember(targetMember) {
    if (!state.teamCode || !targetMember) return;
    const ok = confirm(`确定要将成员【${targetMember.name}】移出当前小队吗？\n移出后TA将无法继续在雷达上查看和共享本小队位置。`);
    if (!ok) return;

    fetch('/api/team/kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamCode: state.teamCode,
        operatorUserId: state.user?.id || '',
        targetUserId: targetMember.userId,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          showToast(`已成功将【${targetMember.name}】移出小队！`);
          state.teamMembers = state.teamMembers.filter((m) => m.userId !== targetMember.userId);
          renderTeamMembersUI();
          updateTeamMapMarkers();
        } else {
          showToast(data.message || '移出失败', 'error');
        }
      })
      .catch((err) => {
        showToast('请求接口失败: ' + err.message, 'error');
      });
  }

  function handleRoomKickedOrDisbanded(type, message) {
    const oldRoom = state.teamCode;
    state.teamCode = '';
    try {
      localStorage.setItem(STORAGE_KEYS.TEAM_CODE, '');
    } catch (e) {}

    state.teamMembers = [];
    state.roomOwnerId = '';
    state.roomOwnerName = '';
    state.isRoomOwner = false;

    state.overviewTeamMarkers.forEach((m) => state.map?.removeLayer(m));
    state.overviewTeamMarkers.clear();
    state.radarTeamMarkers.forEach((m) => state.radarMap?.removeLayer(m));
    state.radarTeamMarkers.clear();

    updateRoomBadgesUI();
    renderTeamMembersUI();
    updateTeamMapMarkers();

    if (type === 'kicked') {
      showToast(message || `您已被房主移出小队房间 #${oldRoom}，已自动切回单人模式`, 'error');
    } else {
      showToast(message || `小队房间 #${oldRoom} 已被房主解散，已切回单人守护模式`, 'warning');
    }
  }

  function fitAllMembers(mapInstance) {
    if (!mapInstance || !window.L) return;
    const points = [];
    if (state.location.lat !== null && state.location.lng !== null && state.location.granted) {
      const myDisp = toMapCoordinate(state.location.lat, state.location.lng);
      points.push([myDisp.lat, myDisp.lng]);
    }

    state.teamMembers.forEach((m) => {
      const isMe = state.user && (m.userId === state.user.id || m.username === state.user.username);
      if (!isMe && m.lat && m.lng) {
        // 如果当前有境内坐标，过滤掉残留的默认曼谷占位坐标 (13.7563)
        if (m.lat === 13.7563 && m.lng === 100.5018 && state.teamMembers.some((o) => o.lat > 20)) {
          return;
        }
        const mDisp = toMapCoordinate(m.lat, m.lng);
        points.push([mDisp.lat, mDisp.lng]);
      }
    });

    if (points.length > 1) {
      mapInstance.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16 });
      showToast('已自适应缩放至全队视野');
    } else if (points.length === 1) {
      mapInstance.setView(points[0], 14);
      showToast('已对齐当前成员视野');
    }
  }

  function reportMyLocation() {
    const isLoggedIn = Boolean(state.token && state.user && state.user.id && !state.user.id.startsWith('user_guest'));
    if (!isLoggedIn) return;

    // 如果尚未获取到有效定位（仍处于未授权或 null），不要向小队上报虚假的曼谷坐标！
    if (state.location.lat === null || state.location.lng === null || !state.location.granted) {
      return;
    }
    const lat = state.location.lat;
    const lng = state.location.lng;

    fetch('/api/team/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamCode: state.teamCode,
        userId: state.user.id,
        username: state.user.username,
        name: state.profile.name || state.user.name || (state.user.username ? `队友#${state.user.username.slice(-4)}` : '队友'),
        avatar: state.profile.avatar || state.user.avatar || '',
        phone: state.profile.phone || state.user.phone || '',
        lat,
        lng,
        accuracy: state.location.accuracy || 20,
        status: 'normal',
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data) return;
        if (data.disbanded) {
          handleRoomKickedOrDisbanded('disbanded', data.message);
          return;
        }
        if (data.kicked) {
          handleRoomKickedOrDisbanded('kicked', data.message);
          return;
        }
        if (data.ownerId && data.ownerId !== state.roomOwnerId) {
          state.roomOwnerId = data.ownerId;
          state.roomOwnerName = data.ownerName || '';
          state.isRoomOwner = !!(state.user && state.roomOwnerId === state.user.id);
          updateRoomBadgesUI();
        }
      })
      .catch(() => {});
  }

  function fetchTeamMembers() {
    if (!state.teamCode) {
      state.teamMembers = [];
      renderTeamMembersUI();
      updateTeamMapMarkers();
      return;
    }

    fetch(`/api/team/members?teamCode=${encodeURIComponent(state.teamCode)}&userId=${encodeURIComponent(state.user?.id || '')}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data) return;
        if (data.disbanded) {
          handleRoomKickedOrDisbanded('disbanded', data.message);
          return;
        }
        if (data.kicked) {
          handleRoomKickedOrDisbanded('kicked', data.message);
          return;
        }
        if (Array.isArray(data.members)) {
          // 严格剔除历史游客与行者身份
          state.teamMembers = data.members.filter((m) => {
            if (!m || !m.userId) return false;
            const uid = String(m.userId);
            const uname = String(m.username || '');
            const nick = String(m.name || '');
            return !uid.startsWith('user_guest') && uid !== 'guest' && !uname.startsWith('guest') && !nick.startsWith('行者');
          });
          state.roomOwnerId = data.ownerId || '';
          state.roomOwnerName = data.ownerName || '';
          state.isRoomOwner = !!(state.user && state.roomOwnerId && state.roomOwnerId === state.user.id);
          renderTeamMembersUI();
          updateTeamMapMarkers();
          updateRoomBadgesUI();
        }
      })
      .catch(() => {});
  }

  function renderTeamMembersUI() {
    const myLat = state.location.lat || DEFAULT_BANGKOK.lat;
    const myLng = state.location.lng || DEFAULT_BANGKOK.lng;

    const hasTeam = Boolean(state.teamCode && state.teamCode.trim().length > 0);

    // 1. 更新中控台简易列表
    const overviewListEl = document.getElementById('team-members-list');
    const overviewCountEl = document.getElementById('team-online-count');
    if (overviewCountEl) {
      overviewCountEl.innerHTML = hasTeam
        ? `<i data-lucide="users"></i> ${state.teamMembers.length} 人实时在线`
        : `<i data-lucide="shield"></i> 单人守护模式就绪`;
    }
    if (overviewListEl) {
      overviewListEl.innerHTML = '';
      if (!hasTeam) {
        overviewListEl.innerHTML = `
          <div style="text-align:center;padding:14px;color:var(--text-muted);font-size:0.8rem;">
            当前处于单人独立模式，点击“房间号”或右上角“加入小队”即可与同行好友实时互联。
          </div>
        `;
      } else if (state.teamMembers.length === 0) {
        overviewListEl.innerHTML = `
          <div style="text-align:center;padding:14px;color:var(--text-muted);font-size:0.8rem;">
            房间内暂无其他成员，等待同伴加入...
          </div>
        `;
      } else {
        state.teamMembers.forEach((member) => {
          const isMe = state.user && (member.userId === state.user.id || member.username === state.user.username);
          const distM = calculateDistance(myLat, myLng, member.lat, member.lng);
          const distStr = isMe ? '我的位置' : `距你 ${formatDistance(distM)}`;
          const isOwner = member.userId === state.roomOwnerId;

          const item = document.createElement('div');
          item.className = 'team-member-item';
          item.innerHTML = `
            <div class="team-member-info">
              <div class="member-avatar-mini">
                ${
                  member.avatar
                    ? `<img src="${member.avatar}" alt="Avatar">`
                    : (member.name ? member.name.charAt(0) : '友')
                }
              </div>
              <div class="member-text">
                <strong>${escapeHtml(member.name)} ${isMe ? '<span style="color:var(--blue-400);font-size:0.7rem;">(我)</span>' : ''} ${isOwner ? '<span class="room-role-pill is-owner" style="margin-left:4px;"><i data-lucide="crown"></i> 房主</span>' : ''}</strong>
                <span>坐标: ${member.lat.toFixed(4)}, ${member.lng.toFixed(4)} · 误差约 ±${member.accuracy}米</span>
              </div>
            </div>
            <div class="distance-pill ${isMe ? 'is-me' : ''}">
              ${distStr}
            </div>
          `;
          overviewListEl.appendChild(item);
        });
      }
    }

    // 2. 更新独立雷达中心全景花名册与在线药丸
    const radarRosterListEl = document.getElementById('radar-roster-list');
    const radarRosterCountEl = document.getElementById('radar-roster-count');
    const radarRosterPillText = document.getElementById('radar-roster-pill-text');

    if (radarRosterCountEl) {
      radarRosterCountEl.innerHTML = hasTeam
        ? `<i data-lucide="users"></i> ${state.teamMembers.length}人在线`
        : `<i data-lucide="shield"></i> 单人模式`;
    }
    if (radarRosterPillText) {
      radarRosterPillText.textContent = hasTeam
        ? `${state.teamMembers.length}人在线`
        : '单人模式';
    }

    if (radarRosterListEl) {
      radarRosterListEl.innerHTML = '';
      if (!hasTeam) {
        radarRosterListEl.innerHTML = `
          <div style="text-align:center;padding:24px 12px;color:var(--text-muted);font-size:0.82rem;">
            <i data-lucide="shield" style="width:28px;height:28px;display:block;margin:0 auto 8px;opacity:0.6;color:var(--emerald-400);"></i>
            <strong>当前处于单人独立守护模式</strong>
            <span style="font-size:0.75rem;opacity:0.75;margin-top:4px;display:block;">
              点击上方“创建 / 切换房间”即可生成专属房间号，邀请亲友同行互看！
            </span>
          </div>
        `;
      } else if (state.teamMembers.length === 0) {
        radarRosterListEl.innerHTML = `
          <div style="text-align:center;padding:20px 10px;color:var(--text-muted);font-size:0.8rem;">
            房间 #${state.teamCode} 暂无其他在线成员，分享房间码给同行朋友加入吧！
          </div>
        `;
      } else {
        state.teamMembers.forEach((member) => {
          const isMe = state.user && (member.userId === state.user.id || member.username === state.user.username);
          const distM = calculateDistance(myLat, myLng, member.lat, member.lng);
          const distStr = isMe ? '当前位置' : formatDistance(distM);
          const isOwner = member.userId === state.roomOwnerId;

          const item = document.createElement('div');
          item.className = 'radar-roster-item';
          item.title = '点击可在地图上聚焦该成员';
          item.innerHTML = `
            <div class="radar-roster-left">
              <div class="radar-roster-avatar">
                ${
                  member.avatar
                    ? `<img src="${member.avatar}" alt="${escapeHtml(member.name)}">`
                    : (member.name ? member.name.charAt(0) : '友')
                }
              </div>
              <div class="radar-roster-info">
                <strong>${escapeHtml(member.name)} ${isMe ? '<span style="color:var(--blue-400);font-size:0.75rem;">(我)</span>' : ''} ${isOwner ? '<span class="room-role-pill is-owner" style="margin-left:4px;"><i data-lucide="crown"></i> 房主</span>' : ''}</strong>
                <span>${member.phone || '未公开电话'} · 经纬: ${member.lat.toFixed(3)}, ${member.lng.toFixed(3)}</span>
              </div>
            </div>
            <div class="radar-roster-right">
              <div class="radar-roster-dist">
                ${distStr}
              </div>
              ${
                state.isRoomOwner && !isMe
                  ? `<button class="kick-member-btn" type="button" title="移出小队"><i data-lucide="user-minus"></i> 踢出</button>`
                  : ''
              }
            </div>
          `;

          // 点击整行聚焦地图
          item.addEventListener('click', (e) => {
            if (e.target.closest('.kick-member-btn')) return;
            if (state.radarMap) {
              const disp = toMapCoordinate(member.lat, member.lng);
              state.radarMap.flyTo([disp.lat, disp.lng], 16, { duration: 1.2 });
              const marker = state.radarTeamMarkers.get(member.userId);
              if (marker) {
                setTimeout(() => marker.openPopup(), 1200);
              }
              showToast(`已在全景地图中定位聚焦：${member.name}`);
            }
          });

          // 绑定踢人按钮
          const kickBtn = item.querySelector('.kick-member-btn');
          if (kickBtn) {
            kickBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              kickTeamMember(member);
            });
          }

          radarRosterListEl.appendChild(item);
        });
      }
    }

    initIcons();
  }

  function createTeamPinIcon(member, myLat, myLng) {
    const distM = calculateDistance(myLat, myLng, member.lat, member.lng);
    const distStr = formatDistance(distM);

    const avatarHtml = member.avatar
      ? `<img src="${member.avatar}" alt="${escapeHtml(member.name)}">`
      : escapeHtml(member.name ? member.name.charAt(0) : '友');

    const pinHtml = `
      <div class="radar-avatar-marker">
        <div class="radar-avatar-pulse"></div>
        <div class="radar-avatar-bubble">
          <span>${escapeHtml(member.name)}</span>
          <span class="pin-dist">(${distStr})</span>
        </div>
        <div class="radar-avatar-ring">
          ${avatarHtml}
        </div>
        <div class="radar-avatar-pointer"></div>
      </div>
    `;

    return L.divIcon({
      className: 'radar-avatar-leaflet-marker',
      html: pinHtml,
      iconSize: [42, 48],
      iconAnchor: [21, 48],
      popupAnchor: [0, -48],
    });
  }

  function updateMapMarkersForInstance(mapInstance, markerMap) {
    if (!mapInstance || !window.L) return;

    const myLat = state.location.lat || DEFAULT_BANGKOK.lat;
    const myLng = state.location.lng || DEFAULT_BANGKOK.lng;
    const activeUserIds = new Set();

    state.teamMembers.forEach((member) => {
      const isMe = state.user && (member.userId === state.user.id || member.username === state.user.username);
      if (isMe) return;

      activeUserIds.add(member.userId);
      const distM = calculateDistance(myLat, myLng, member.lat, member.lng);
      const distStr = formatDistance(distM);

      const teamPinIcon = createTeamPinIcon(member, myLat, myLng);
      const disp = toMapCoordinate(member.lat, member.lng);

      if (markerMap.has(member.userId)) {
        const existingMarker = markerMap.get(member.userId);
        existingMarker.setLatLng([disp.lat, disp.lng]);
        existingMarker.setIcon(teamPinIcon);
      } else {
        const newMarker = L.marker([disp.lat, disp.lng], { icon: teamPinIcon }).addTo(mapInstance);
        newMarker.bindPopup(`
          <div style="font-size: 0.85rem; padding: 4px;">
            <strong style="display:block;margin-bottom:2px;">${escapeHtml(member.name)}</strong>
            <div style="color:#64748b;font-size:0.75rem;margin:2px 0;">电话: ${escapeHtml(member.phone || '未公开')}</div>
            <div style="color:#10b981;font-weight:600;">相对距离: ${distStr}</div>
            ${member.phone ? `<a href="tel:${escapeHtml(member.phone)}" style="display:inline-block;margin-top:6px;padding:4px 10px;background:#10b981;color:#fff;border-radius:4px;text-decoration:none;font-size:0.75rem;font-weight:600;">一键呼叫</a>` : ''}
          </div>
        `);
        markerMap.set(member.userId, newMarker);
      }
    });

    for (const [uid, marker] of markerMap.entries()) {
      if (!activeUserIds.has(uid)) {
        mapInstance.removeLayer(marker);
        markerMap.delete(uid);
      }
    }
  }

  function updateTeamMapMarkers() {
    updateMapMarkersForInstance(state.map, state.overviewTeamMarkers);
    updateMapMarkersForInstance(state.radarMap, state.radarTeamMarkers);
    updateMyRadarMarker();
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // 半径 (米)
    const rad = Math.PI / 180;
    const phi1 = lat1 * rad;
    const phi2 = lat2 * rad;
    const deltaPhi = (lat2 - lat1) * rad;
    const deltaLambda = (lon2 - lon1) * rad;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function formatDistance(meters) {
    if (isNaN(meters)) return '--';
    if (meters < 1000) {
      return `${Math.round(meters)}米`;
    }
    return `${(meters / 1000).toFixed(1)}公里`;
  }

  // ==========================================
  // 图片上传服务 (头像与现场险情照片上传)
  // ==========================================
  function initImageUpload() {
    const avatarInput = document.getElementById('avatar-file-input');
    const avatarTrigger = document.getElementById('avatar-upload-trigger');
    const triggerAvatarBtn = document.getElementById('trigger-avatar-btn');

    function openFilePicker() {
      if (avatarInput) avatarInput.click();
    }

    if (avatarTrigger) avatarTrigger.addEventListener('click', openFilePicker);
    if (triggerAvatarBtn) triggerAvatarBtn.addEventListener('click', openFilePicker);

    if (avatarInput) {
      avatarInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          showToast('请选择有效的图片文件 (JPG / PNG / WebP)', 'error');
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          showToast('图片大小不能超过 10MB', 'error');
          return;
        }

        showToast('正在上传图片到 Cloudflare Worker...');

        const formData = new FormData();
        formData.append('file', file);

        fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success && data.url) {
              state.profile.avatar = data.url;
              if (state.user) {
                state.user.avatar = data.url;
                try {
                  localStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(state.user));
                } catch (err) {}
              }

              saveProfileData();
              updateAuthUI();
              updateProfileUI();
              reportMyLocation();
              showToast('真实头像上传成功，已同步至小队雷达！');
            } else {
              showToast(data.message || '图片上传失败', 'error');
            }
          })
          .catch((err) => {
            showToast('上传接口错误: ' + err.message, 'error');
          });
      });
    }
  }

  // ==========================================
  // 11. 边缘端存活检测 API
  // ==========================================
  function fetchBackendHealth() {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        console.log('[Cloudflare Edge Worker]', data);
      })
      .catch((err) => {
        console.log('Worker API 待本地启动或由静态资源托管:', err.message);
      });
  }

  // ==========================================
  // 12. 专属实时动态追踪查看器 (Live Tracking Mode)
  // ==========================================
  let activeTrackingInterval = null;
  let trackingTargetMarker = null;

  function initLiveTrackingViewer() {
    const params = new URLSearchParams(window.location.search);
    const trackTarget = params.get('track') || params.get('user');
    const roomParam = params.get('room');

    if (roomParam && roomParam !== state.teamCode) {
      state.teamCode = roomParam;
      try {
        localStorage.setItem(STORAGE_KEYS.TEAM_CODE, roomParam);
      } catch (e) {}
      updateRoomBadgesUI();
    }

    if (!trackTarget) return;

    // 自动切换到雷达视图并开启实时动态追踪
    setTimeout(() => {
      const radarNavBtn = document.querySelector('[data-view="radar"]');
      if (radarNavBtn) radarNavBtn.click();
      startTrackingUser(trackTarget);
    }, 350);
  }

  function startTrackingUser(username) {
    if (activeTrackingInterval) {
      clearInterval(activeTrackingInterval);
      activeTrackingInterval = null;
    }

    const banner = document.getElementById('radar-live-tracking-banner');
    const titleEl = document.getElementById('tracking-banner-title');
    const subEl = document.getElementById('tracking-banner-sub');
    const callBtn = document.getElementById('tracking-call-btn');
    const navBtn = document.getElementById('tracking-nav-btn');
    const focusBtn = document.getElementById('tracking-focus-btn');
    const exitBtn = document.getElementById('tracking-exit-btn');

    if (banner) banner.removeAttribute('hidden');

    let currentTargetData = null;

    function pollUserLocation(isFirst = false) {
      fetch(`/api/track/${encodeURIComponent(username)}`)
        .then((res) => res.json())
        .then((data) => {
          if (!data || !data.success || !data.user) {
            if (isFirst) {
              showToast(`未能查到用户【${username}】的实时坐标，该用户可能尚未开启定位`, 'error');
              if (subEl) subEl.textContent = '未查到实时心跳，可能已离线或尚未授权 GPS';
            }
            return;
          }

          const target = data.user;
          currentTargetData = target;

          const myLat = state.location.lat || DEFAULT_BANGKOK.lat;
          const myLng = state.location.lng || DEFAULT_BANGKOK.lng;
          const distM = calculateDistance(myLat, myLng, target.lat, target.lng);
          const distStr = formatDistance(distM);

          if (titleEl) {
            titleEl.innerHTML = `正在实时动态追踪：<strong>${escapeHtml(target.name)}</strong> (${escapeHtml(target.username)})`;
          }
          if (subEl) {
            subEl.textContent = `最新心跳: ${target.timeAgo} · 相对距离: 距你约 ${distStr} · 坐标: ${target.lat.toFixed(4)}, ${target.lng.toFixed(4)}`;
          }

          if (callBtn) {
            if (target.phone) {
              callBtn.style.display = 'inline-flex';
              callBtn.href = `tel:${target.phone}`;
            } else {
              callBtn.style.display = 'none';
            }
          }

          if (navBtn) {
            navBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`;
          }

          // 在地图上突出渲染目标头像标点
          if (state.radarMap) {
            const pinIcon = createTeamPinIcon(target, myLat, myLng);
            const disp = toMapCoordinate(target.lat, target.lng);
            if (!trackingTargetMarker) {
              trackingTargetMarker = L.marker([disp.lat, disp.lng], { icon: pinIcon, zIndexOffset: 2000 }).addTo(state.radarMap);
            } else {
              trackingTargetMarker.setIcon(pinIcon);
              trackingTargetMarker.setLatLng([disp.lat, disp.lng]);
            }

            if (isFirst) {
              state.radarMap.flyTo([disp.lat, disp.lng], 16, { duration: 1.5 });
              showToast(`已成功锁定【${target.name}】的实时动态位置！`);
            }
          }
        })
        .catch(() => {});
    }

    pollUserLocation(true);
    activeTrackingInterval = setInterval(() => pollUserLocation(false), 4000);

    if (focusBtn) {
      focusBtn.onclick = () => {
        if (currentTargetData && state.radarMap) {
          const disp = toMapCoordinate(currentTargetData.lat, currentTargetData.lng);
          state.radarMap.flyTo([disp.lat, disp.lng], 16);
          showToast(`已居中聚焦【${currentTargetData.name}】`);
        }
      };
    }

    if (exitBtn) {
      exitBtn.onclick = () => {
        if (activeTrackingInterval) {
          clearInterval(activeTrackingInterval);
          activeTrackingInterval = null;
        }
        if (banner) banner.setAttribute('hidden', '');
        if (trackingTargetMarker && state.radarMap) {
          state.radarMap.removeLayer(trackingTargetMarker);
          trackingTargetMarker = null;
        }
        // 清除 url 参数
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        showToast('已退出实时动态追踪模式');
      };
    }
  }

  // ==========================================
  // 13. 工具函数 (Toast, Clipboard, Helper)
  // ==========================================
  function updateAllViews() {
    updateProfileUI();
    updateLocationUI();
    updateReadinessScore();
  }

  function copyToClipboard(text, customMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast(customMsg || '已成功复制至剪贴板！'))
        .catch(() => fallbackCopy(text, customMsg));
    } else {
      fallbackCopy(text, customMsg);
    }
  }

  function fallbackCopy(text, customMsg) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast(customMsg || '已成功复制！');
    } catch (e) {
      showToast('复制失败，请手动长按复制', 'error');
    }
    document.body.removeChild(textArea);
  }

  function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
    toast.innerHTML = `
      <i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle-2'}"></i>
      <span>${escapeHtml(msg)}</span>
    `;

    container.appendChild(toast);
    initIcons();

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s, transform 0.3s';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
