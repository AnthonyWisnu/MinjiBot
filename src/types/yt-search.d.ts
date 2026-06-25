declare module "yt-search" {
  interface YoutubeSearchAuthor {
    name: string;
  }

  export interface YoutubeSearchVideo {
    author: YoutubeSearchAuthor;
    seconds: number;
    timestamp: string;
    title: string;
    url: string;
    videoId: string;
  }

  interface YoutubeSearchResult {
    videos: YoutubeSearchVideo[];
  }

  function yts(query: string): Promise<YoutubeSearchResult>;

  export default yts;
}
