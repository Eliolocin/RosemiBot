export default {
  booru: {
    description: `Find existing anime art`,
    search: {
      description: `Post 4 random well-rated Danbooru images for one or two tags`,
      tag_description: `A character, series, or tag (suggestions appear as you type)`,
      second_tag_description: `An optional second tag to narrow the search`,
      rating_description: `Which rating to show (default: general and sensitive)`,
      general_option: `General`,
      sensitive_option: `Sensitive`,
      questionable_option: `Questionable (age-restricted channels only)`,
      explicit_option: `Explicit (age-restricted channels only)`,
      rating_restricted_title: `This rating needs an age-restricted channel`,
      rating_restricted_description: `Questionable and explicit results only show in channels marked age-restricted. Pick General or Sensitive, or run this in an age-restricted channel.`,
      no_results_title: `No posts found`,
      no_results_description: `Danbooru had no well-rated posts for {query}. Check the spelling, or try a single tag.`,
      error_title: `Danbooru didn't respond`,
      error_description: `Try again in a minute.`,
    },
  },
};
