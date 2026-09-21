# Elementor 4.2.4 V4 data format (verified on staging 2026-09-21)

Element: { id (7 hex), elType ("e-flexbox"|"e-div-block"|"e-grid"|"widget"), widgetType ("e-heading"|"e-paragraph"|"e-button"|"e-image"|"e-svg"|"e-self-hosted-video"), settings, styles, elements, editor_settings: {title}, version: "0.0", interactions? }

settings.classes = {"$$type":"classes","value":["<local style id>","<global label>"]}
settings.tag = {"$$type":"string","value":"section"}  (containers: div header section article aside footer a button; heading: h1..h6; paragraph: p span)
settings.title / paragraph / text = {"$$type":"html-v3","value":{"content":{"$$type":"string","value":"..."},"children":[]}}
settings.link = {"$$type":"link","value":{"destination":{"$$type":"url","value":"/x"},"isTargetBlank":{"$$type":"boolean","value":false},"tag":{"$$type":"string","value":"a"}}}
settings.svg = {"$$type":"svg-src","value":{"id":{"$$type":"image-attachment-id","value":9},"url":null}}
settings.image = {"$$type":"image","value":{"src":{"$$type":"image-src","value":{"id":{"$$type":"image-attachment-id","value":12},"url":null,"alt":{"$$type":"string","value":""}}},"size":{"$$type":"string","value":"full"}}}
settings.source (video) = {"$$type":"video-src","value":{"id":null,"url":{"$$type":"url","value":"https://..."}}}

styles = { "<id>": { id, type:"class", label:"local", variants:[ { meta:{breakpoint:"desktop"|"tablet"|"mobile", state:null|"hover"|"focus"|"active"}, props:{...} } ] } }
Local style id: e-<elementId>-<7hex>. Global class: e_global_class post, id g-<7hex>, HTML class = label, CSS `.elementor .<label>{}`.
Props are produced by Css_Converter::convert(css) on the server; never hand-write them.

Variables: kit meta _elementor_global_variables v2: {"data":{"e-gv-xxxxxxx":{"type":"global-color-variable","label":"sky","value":{"$$type":"color","value":"#37B5FF"},"order":1,...}},"watermark":N,"version":2}. Referenced as var(--label) in CSS; the converter emits {"$$type":"global-color-variable","value":"e-gv-..."}.

Interactions (Free: triggers load, scrollIn; effects fade, slide, scale): element.interactions = {"items":[{"$$type":"interaction-item","value":{"interaction_id":{"$$type":"string","value":"temp-..."},"trigger":{"$$type":"string","value":"scrollIn"},"animation":{"$$type":"animation-preset-props","value":{"effect":...,"type":{"$$type":"string","value":"in"},"direction":...,"timing_config":{"$$type":"timing-config","value":{"duration":{"$$type":"size","value":{"size":600,"unit":"ms"}},"delay":...}}}}}}],"version":1}

Save path: Plugin::$instance->documents->get($id)->save(['elements'=>..., 'settings'=>[...]]) with wp_set_current_user(1). Front-end CSS lands in uploads/elementor/css/{global,local}-<postid>-frontend-{desktop,mobile}.css; variables on the kit selector in post-<kit>.css.
