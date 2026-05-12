import { useState, useEffect, useContext, createContext, useCallback, useMemo } from 'react';

const STORAGE_KEY = "vgs.state.v3";

const SAMPLE_VIDEOS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4",
];

const SEED_VIDEOS = [
  {
    id: "v_seed_1",
    title: "Neon courier weaving through 2049 rain",
    prompt: "A leather-jacketed courier on a glowing motorcycle weaves between flying cars in heavy neon rain, reflections shimmering on wet asphalt, anamorphic lens flares, 24fps cinematic",
    src: SAMPLE_VIDEOS[0],
    thumb: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=800&q=70&auto=format",
    duration: 12, resolution: "2K", aspect: "16:9", model: "seedance-pro",
    mode: "t2v", camera: "dynamic", seed: 41201,
    createdAt: Date.now() - 1000 * 60 * 60 * 36,
  },
  {
    id: "v_seed_2",
    title: "Sunlit pour, slow ceramic",
    prompt: "Macro shot of matcha being poured into a hand-thrown ceramic bowl, soft morning window light, dust motes, shallow depth of field, 50mm",
    src: SAMPLE_VIDEOS[2],
    thumb: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=800&q=70&auto=format",
    duration: 5, resolution: "1080p", aspect: "1:1", model: "seedance-pro",
    mode: "i2v", camera: "fixed", seed: 88312,
    createdAt: Date.now() - 1000 * 60 * 60 * 12,
  },
  {
    id: "v_seed_3",
    title: "Sweater dog spinning on the back porch",
    prompt: "Golden retriever in a wool sweater chasing its tail on a sunlit wooden porch, fall leaves drifting, handheld feel",
    src: SAMPLE_VIDEOS[3],
    thumb: "https://images.unsplash.com/photo-1583511655826-05700d52f4d9?w=800&q=70&auto=format",
    duration: 5, resolution: "720p", aspect: "9:16", model: "seedance-lite",
    mode: "t2v", camera: "dynamic", seed: 23119,
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
  },
  {
    id: "v_seed_4",
    title: "Brutalist tower at golden hour",
    prompt: "Aerial pull-back from a brutalist concrete tower with overgrown rooftop garden, golden hour, drone shot, faint birds, 1.85:1",
    src: SAMPLE_VIDEOS[4],
    thumb: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=70&auto=format",
    duration: 15, resolution: "2K", aspect: "16:9", model: "seedance-pro",
    mode: "t2v", camera: "dynamic", seed: 7740,
    createdAt: Date.now() - 1000 * 60 * 60 * 2,
  },
  {
    id: "v_seed_5",
    title: "Steam, espresso, marble counter",
    prompt: "Close-up of espresso pouring into a glass cup on a white marble counter, steam curling, warm window light, very shallow DOF",
    src: SAMPLE_VIDEOS[5],
    thumb: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=70&auto=format",
    duration: 5, resolution: "1080p", aspect: "16:9", model: "seedance-pro",
    mode: "i2v", camera: "fixed", seed: 5512,
    createdAt: Date.now() - 1000 * 60 * 25,
  },
  {
    id: "v_seed_6",
    title: "Paper plane through library light",
    prompt: "A folded paper plane glides slowly through a sunlit library corridor, dust suspended in beams, tracking shot from behind",
    src: SAMPLE_VIDEOS[6],
    thumb: "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=70&auto=format",
    duration: 5, resolution: "720p", aspect: "16:9", model: "seedance-lite",
    mode: "t2v", camera: "dynamic", seed: 31099,
    createdAt: Date.now() - 1000 * 60 * 8,
  },
];

const SEED_IMAGES = [
  {
    id: "i_seed_1",
    name: "porch-dog.jpg",
    src: "https://images.unsplash.com/photo-1583511655826-05700d52f4d9?w=600&q=70&auto=format",
    addedAt: Date.now() - 1000 * 60 * 60 * 10,
  },
  {
    id: "i_seed_2",
    name: "marble-counter.jpg",
    src: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=70&auto=format",
    addedAt: Date.now() - 1000 * 60 * 60 * 4,
  },
  {
    id: "i_seed_3",
    name: "rooftop-garden.jpg",
    src: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=600&q=70&auto=format",
    addedAt: Date.now() - 1000 * 60 * 60 * 2,
  },
];

const DEFAULT_STATE = {
  apiKey: "",
  videos: SEED_VIDEOS,
  images: SEED_IMAGES,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("save failed", e);
  }
}

const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [state, setState] = useState(loadState);

  useEffect(() => { saveState(state); }, [state]);

  const setApiKey = useCallback((apiKey) => setState((s) => ({ ...s, apiKey })), []);

  const addImage = useCallback((img) => {
    const item = {
      id: "i_" + Math.random().toString(36).slice(2, 9),
      addedAt: Date.now(),
      ...img,
    };
    setState((s) => ({ ...s, images: [item, ...s.images] }));
    return item;
  }, []);

  const removeImage = useCallback((id) => {
    setState((s) => ({ ...s, images: s.images.filter((i) => i.id !== id) }));
  }, []);

  const addVideo = useCallback((v) => {
    const item = {
      id: "v_" + Math.random().toString(36).slice(2, 9),
      createdAt: Date.now(),
      ...v,
    };
    setState((s) => ({ ...s, videos: [item, ...s.videos] }));
    return item;
  }, []);

  const removeVideo = useCallback((id) => {
    setState((s) => ({ ...s, videos: s.videos.filter((v) => v.id !== id) }));
  }, []);

  const updateVideo = useCallback((id, patch) => {
    setState((s) => ({
      ...s,
      videos: s.videos.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));
  }, []);

  const upsertVideo = useCallback((video) => {
    const item = {
      id: "v_" + Math.random().toString(36).slice(2, 9),
      createdAt: Date.now(),
      ...video,
    };
    setState((s) => {
      const exists = s.videos.some((v) => v.id === item.id);
      return {
        ...s,
        videos: exists
          ? s.videos.map((v) => (v.id === item.id ? { ...v, ...item } : v))
          : [item, ...s.videos],
      };
    });
    return item;
  }, []);

  const value = useMemo(
    () => ({ state, setApiKey, addImage, removeImage, addVideo, removeVideo, updateVideo, upsertVideo }),
    [state, setApiKey, addImage, removeImage, addVideo, removeVideo, updateVideo, upsertVideo]
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore outside StoreProvider");
  return ctx;
}

export function useHashRoute() {
  const parse = () => {
    const h = window.location.hash.slice(1) || "/";
    const [path, qs] = h.split("?");
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    return { path, query };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const fn = () => setRoute(parse());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  const navigate = useCallback((path, query) => {
    let url = "#" + path;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      if (qs) url += "?" + qs;
    }
    window.location.hash = url.slice(1);
  }, []);
  return { ...route, navigate };
}

export function relTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const d = Math.floor(hr / 24);
  return d + "d ago";
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function pickSampleVideo(seed) {
  const idx = Math.abs((seed | 0) + Math.floor(Math.random() * 100)) % SAMPLE_VIDEOS.length;
  return SAMPLE_VIDEOS[idx];
}

const THUMB_BANK = [
  "https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=800&q=70&auto=format",
  "https://images.unsplash.com/photo-1542315192-1f61a1792f33?w=800&q=70&auto=format",
  "https://images.unsplash.com/photo-1490604001847-b712b0c2f967?w=800&q=70&auto=format",
  "https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3?w=800&q=70&auto=format",
  "https://images.unsplash.com/photo-1502209524164-acea936639a2?w=800&q=70&auto=format",
  "https://images.unsplash.com/photo-1518614368389-d0bc8d3a1c12?w=800&q=70&auto=format",
  "https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=800&q=70&auto=format",
  "https://images.unsplash.com/photo-1517398658956-3027ed1afb55?w=800&q=70&auto=format",
];

export function pickThumb(seed) {
  const idx = Math.abs((seed | 0) + Math.floor(Math.random() * 100)) % THUMB_BANK.length;
  return THUMB_BANK[idx];
}
