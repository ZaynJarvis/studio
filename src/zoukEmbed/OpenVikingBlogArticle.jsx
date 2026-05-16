import { Icon } from '../components';
import { OPENVIKING_BLOG } from './openVikingBlogContent';

function renderBlock(block, index) {
  if (block.type === 'heading') {
    return <h2 key={index}>{block.text}</h2>;
  }
  if (block.type === 'subheading') {
    return <h3 key={index}>{block.text}</h3>;
  }
  if (block.type === 'list') {
    return (
      <ul key={index}>
        {block.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  return <p key={index}>{block.text}</p>;
}

export function OpenVikingBlogArticle({
  articleRef,
  selectionAction,
  showSelectionAsk,
  onAskSelection,
  onMouseUp,
  onTouchEnd,
}) {
  return (
    <>
      <header className="zouk-blog-bar">
        <a className="zouk-brand" href={OPENVIKING_BLOG.sourceUrl} aria-label="OpenViking home">
          <img src={OPENVIKING_BLOG.logoUrl} alt="" />
          <strong>OpenViking</strong>
        </a>
        <button className="zouk-menu-button" type="button" aria-label="Open menu">
          <span />
          <span />
          <span />
        </button>
      </header>

      <main
        className="zouk-article"
        ref={articleRef}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
      >
        <a className="zouk-return" href="https://www.openviking.ai/blog">
          <Icon name="arrowLeft" size={20} />
          Return to blog
        </a>
        <div className="zouk-breadcrumb">{OPENVIKING_BLOG.tag}</div>
        <h1 className="zouk-article-title">{OPENVIKING_BLOG.title}</h1>
        <div className="zouk-date">
          <Icon name="calendar" size={17} />
          {OPENVIKING_BLOG.date}
        </div>
        <img
          className="zouk-hero-image"
          src={OPENVIKING_BLOG.heroImageUrl}
          alt={OPENVIKING_BLOG.title}
        />
        <article className="zouk-article-card">
          <h2>{OPENVIKING_BLOG.subtitle}</h2>
          <blockquote>{OPENVIKING_BLOG.quote}</blockquote>
          <div className="zouk-article-body">
            {OPENVIKING_BLOG.body.map(renderBlock)}
          </div>
        </article>
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
    </>
  );
}
