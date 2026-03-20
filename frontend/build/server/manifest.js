const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.BzXooUW0.js",app:"_app/immutable/entry/app.DefEbRKK.js",imports:["_app/immutable/entry/start.BzXooUW0.js","_app/immutable/chunks/D-IfBVE7.js","_app/immutable/chunks/CgWADGt6.js","_app/immutable/chunks/Dhw1IBGp.js","_app/immutable/entry/app.DefEbRKK.js","_app/immutable/chunks/Dhw1IBGp.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/CgWADGt6.js","_app/immutable/chunks/CIv9Qa2k.js","_app/immutable/chunks/DE5_rwdK.js","_app/immutable/chunks/gpF9-zw8.js","_app/immutable/chunks/BIlRfKYF.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./chunks/0-DPJW3aKF.js')),
			__memo(() => import('./chunks/1-D2jFKu5E.js')),
			__memo(() => import('./chunks/2-CG5G3Mah.js')),
			__memo(() => import('./chunks/3-BuCAFsS4.js')),
			__memo(() => import('./chunks/4-ldQAehnL.js')),
			__memo(() => import('./chunks/5-DZc4z1el.js')),
			__memo(() => import('./chunks/6-DkL5IOQk.js')),
			__memo(() => import('./chunks/7-PzT37QDs.js')),
			__memo(() => import('./chunks/8-zEyg-86P.js')),
			__memo(() => import('./chunks/9-Cq_r9_ic.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/crew",
				pattern: /^\/crew\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/projects/[projectId]",
				pattern: /^\/projects\/([^/]+?)\/?$/,
				params: [{"name":"projectId","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,2,], errors: [1,,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/projects/[projectId]/activity",
				pattern: /^\/projects\/([^/]+?)\/activity\/?$/,
				params: [{"name":"projectId","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,2,], errors: [1,,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/projects/[projectId]/issues/[issueId]",
				pattern: /^\/projects\/([^/]+?)\/issues\/([^/]+?)\/?$/,
				params: [{"name":"projectId","optional":false,"rest":false,"chained":false},{"name":"issueId","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,2,], errors: [1,,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/projects/[projectId]/settings",
				pattern: /^\/projects\/([^/]+?)\/settings\/?$/,
				params: [{"name":"projectId","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,2,], errors: [1,,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/settings",
				pattern: /^\/settings\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

const prerendered = new Set([]);

const base = "";

export { base, manifest, prerendered };
//# sourceMappingURL=manifest.js.map
