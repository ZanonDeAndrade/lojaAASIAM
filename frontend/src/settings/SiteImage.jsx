import { assetUrl, imageSettings, imageStyle } from './site.js';

export default function SiteImage({ src, alt = '', style, ...props }) {
  const media = imageSettings(src);
  return <img {...props} src={assetUrl(src)} alt={media?.alt || alt} style={{ ...style, ...imageStyle(src) }} />;
}
