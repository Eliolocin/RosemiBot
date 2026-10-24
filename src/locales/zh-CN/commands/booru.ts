export default {
  booru: {
    description: `寻找现有的动漫插画`,
    search: {
      description: `根据一个或两个标签随机发送 4 张评价良好的 Danbooru 图像`,
      tag_description: `角色、作品名或标签（输入时显示建议）`,
      second_tag_description: `可选的第二个标签，用于缩小搜索范围`,
      rating_description: `显示哪个分级的图像（默认：全年龄与敏感）`,
      general_option: `全年龄（General）`,
      sensitive_option: `敏感（Sensitive）`,
      questionable_option: `存疑（Questionable，仅限年龄限制频道）`,
      explicit_option: `明确（Explicit，仅限年龄限制频道）`,
      rating_restricted_title: `此分级需要年龄限制频道`,
      rating_restricted_description: `存疑和明确内容仅在标记为年龄限制的频道中显示。请选择全年龄或敏感，或者在年龄限制频道中运行此指令。`,
      no_results_title: `未找到插画`,
      no_results_description: `Danbooru 上没有符合 {query} 的高分插画。请检查拼写，或尝试使用单个标签。`,
      error_title: `Danbooru 未响应`,
      error_description: `请稍后再试。`,
    },
  },
};
