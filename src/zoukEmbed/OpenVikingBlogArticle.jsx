import { useMemo, useState } from 'react';
import { Icon } from '../components';
import {
  BlogContext,
  ExternalArrowIcon,
  ReadingProgress,
  TOC,
  pickLocale,
} from './openvikingBlog/blog-components';
import {
  LANGS,
  THEME_DARK,
  makeFormatDate,
  useShellStrings,
} from './openvikingBlog/shell-core';
import openvikingContextDatabase from './openvikingBlog/posts/openviking-context-database/index.jsx';
import './openvikingBlog/blogTheme.css';

const POST = openvikingContextDatabase;
const DEFAULT_LANG = 'en';

function supportedLang(code) {
  return LANGS.some((lang) => lang.code === code) ? code : DEFAULT_LANG;
}

function readBlogLang() {
  try {
    return supportedLang(localStorage.getItem('blog.lang') || DEFAULT_LANG);
  } catch {
    return DEFAULT_LANG;
  }
}

function writeBlogLang(lang) {
  try {
    localStorage.setItem('blog.lang', lang);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

function OpenVikingTopbar({ lang, onLang, strings }) {
  return (
    <header className="b-topbar">
      <div className="b-topbar__inner">
        <a className="b-brand" href="https://www.openviking.ai/blog">
          <img className="b-brand__mark" src="/assets/logo.png" alt="OpenViking" />
          <span className="b-brand__name">{strings.siteName}</span>
          <span className="b-brand__sub">// {strings.siteSub}</span>
        </a>
        <div className="b-topbar__nav">
          <div className="b-seg" role="tablist" aria-label={strings.langLabel}>
            {LANGS.map((item) => (
              <button
                key={item.code}
                type="button"
                className={lang === item.code ? 'is-active' : ''}
                onClick={() => onLang(item.code)}
              >
                {item.short}
              </button>
            ))}
          </div>
          <a className="b-mode-toggle" href="https://github.com/volcengine/OpenViking" aria-label="OpenViking on GitHub">
            <ExternalArrowIcon />
          </a>
        </div>
      </div>
    </header>
  );
}

export function OpenVikingBlogArticle({
  articleRef,
  selectionAction,
  showSelectionAsk,
  onAskSelection,
  onMouseUp,
  onTouchEnd,
}) {
  const [lang, setLang] = useState(readBlogLang);
  const strings = useShellStrings(lang);
  const formatDate = useMemo(() => makeFormatDate(lang), [lang]);
  const meta = POST.meta;
  const Component = POST.Component;
  const category = pickLocale(meta.category, lang);
  const author = meta.authors?.[0];
  const context = useMemo(() => ({
    lang,
    theme: THEME_DARK,
    fallbackLang: DEFAULT_LANG,
    t: (value) => pickLocale(value, lang),
    formatDate,
    navigate: () => {},
    postSlug: POST.id,
  }), [formatDate, lang]);

  const setLanguage = (nextLang) => {
    const clean = supportedLang(nextLang);
    writeBlogLang(clean);
    setLang(clean);
  };

  return (
    <section className="zouk-blog-content">
      <OpenVikingTopbar lang={lang} onLang={setLanguage} strings={strings} />
      <main
        className="b-shell__main b-post"
        ref={articleRef}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
      >
        <ReadingProgress />

        <div className="b-post__hero">
          <div className="b-post__cover">
            <img src={meta.cover} alt="" />
          </div>
        </div>

        <header className="b-post__head">
          <div className="b-post__eyebrow">
            <a className="b-a" href="https://www.openviking.ai/blog">{strings.backToIndex}</a>
            {category ? <span>· {category}</span> : null}
          </div>
          <h1 className="b-post__title">{pickLocale(meta.title, lang)}</h1>
          {meta.description ? <p className="b-post__sub">{pickLocale(meta.description, lang)}</p> : null}
          <div className="b-post__byline">
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {author ? (
                <div className="b-author">
                  <div>
                    <div className="b-author__name">
                      {author.github ? (
                        <a href={`https://github.com/${author.github}`} target="_blank" rel="noreferrer">
                          {author.name}
                          <ExternalArrowIcon />
                        </a>
                      ) : author.name}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="b-post__times">
              <span><b>{strings.publishedOn}</b> {formatDate(meta.publishedAt)}</span>
              {meta.updatedAt ? <span><b>{strings.updatedOn}</b> {formatDate(meta.updatedAt)}</span> : null}
              {meta.readingTime ? <span>{strings.readingTime(meta.readingTime)}</span> : null}
            </div>
          </div>
        </header>

        <BlogContext.Provider value={context}>
          <div className="b-post__layout">
            <aside className="b-post__sidebar">
              <TOC key={`${POST.id}:${lang}`} title={strings.contents} lang={lang} foldable={false} />
            </aside>
            <div className="b-post__body">
              <Component {...context} />
            </div>
          </div>
        </BlogContext.Provider>
      </main>

      {showSelectionAsk && selectionAction && (
        <button
          className="zouk-selection-ask"
          type="button"
          style={{ top: selectionAction.top, left: selectionAction.left }}
          onClick={() => onAskSelection(selectionAction.text)}
        >
          <Icon name="message" size={13} />
          Ask Zouk
        </button>
      )}
    </section>
  );
}
