export default {
  booru: {
    description: `Tìm tranh anime có sẵn`,
    search: {
      description: `Gửi 4 ảnh Danbooru ngẫu nhiên được đánh giá cao cho một hoặc hai thẻ`,
      tag_description: `Một nhân vật, tác phẩm hoặc thẻ (gợi ý xuất hiện khi bạn nhập)`,
      second_tag_description: `Thẻ thứ hai tùy chọn để thu hẹp tìm kiếm`,
      rating_description: `Mức đánh giá nào cần hiển thị (mặc định: chung và nhạy cảm)`,
      general_option: `Chung (General)`,
      sensitive_option: `Nhạy cảm (Sensitive)`,
      questionable_option: `Nghi vấn (Questionable, chỉ kênh giới hạn độ tuổi)`,
      explicit_option: `18+ (Explicit, chỉ kênh giới hạn độ tuổi)`,
      rating_restricted_title: `Mức đánh giá này cần kênh giới hạn độ tuổi`,
      rating_restricted_description: `Kết quả nghi vấn và 18+ chỉ hiển thị trong các kênh được đánh dấu giới hạn độ tuổi. Hãy chọn Chung hoặc Nhạy cảm, hoặc chạy lệnh này trong kênh giới hạn độ tuổi.`,
      no_results_title: `Không tìm thấy bài đăng nào`,
      no_results_description: `Danbooru không có bài đăng nào được đánh giá cao cho {query}. Hãy kiểm tra chính tả hoặc thử một thẻ duy nhất.`,
      error_title: `Danbooru không phản hồi`,
      error_description: `Vui lòng thử lại sau một phút.`,
    },
  },
};
