export default {
  subscribe: {
    request: {
      title: `Quyền truy cập gói đăng ký`,
      allowance_title: `Hạn mức không đủ`,
      scope: {
        personal: `Gói đăng ký của bạn`,
        server: `Gói đăng ký của máy chủ này`,
      },
      capabilities: {
        text: `văn bản`,
        vision: `phân tích hình ảnh`,
        image: `tạo hình ảnh`,
        video: `tạo video`,
        voice: `tạo giọng nói`,
        decision: `Decision`,
        embedding: `embedding`,
      },
      renewal: `Hạn mức sẽ được làm mới vào {period_end}.`,
      renewal_unknown: `Kiểm tra {subscription} để biết lần làm mới tiếp theo.`,
      allowance_reason: `{scope} không còn đủ hạn mức để xử lý yêu cầu này. {renewal}`,
      capacity_reason: `{scope} không thể hoàn thành yêu cầu này vì dịch vụ đăng ký của TomoriBot không còn dung lượng phục vụ.`,
      fallback_failed: `Không có model dự phòng nào được cấu hình có thể hoàn tất yêu cầu này.`,
      exhausted: `{scope} không còn đủ hạn mức để xử lý yêu cầu này. {renewal} {fallback}\n\nNgười đăng ký có thể chọn gói cao hơn qua {subscription}. Bạn cũng có thể dùng nhà cung cấp AI khác qua {providers} trong khi chờ đợi.`,
      retry_at: `Hãy thử lại vào {retry_at}.`,
      retry_later: `Hãy thử lại sau vài phút.`,
      capacity: `{scope} tạm thời không khả dụng vì dịch vụ đăng ký của TomoriBot đang quá tải. Hạn mức của bạn không bị ảnh hưởng. {retry} {fallback}\n\nBạn cũng có thể dùng nhà cung cấp AI khác qua {providers}.`,
      capacity_unavailable: `{scope} không khả dụng vì dịch vụ đăng ký của TomoriBot đã hết công suất, việc thử lại sẽ không có tác dụng cho đến khi dịch vụ được phục hồi. Hạn mức của bạn không bị ảnh hưởng. {fallback}\n\nTrong lúc đó, bạn có thể dùng nhà cung cấp AI khác qua {providers}.`,
      unsupported: `{scope} không thể dùng model {capability} này. Hãy chọn một model được hỗ trợ hoặc nhà cung cấp AI khác qua {providers}.`,
    },
    tiers: {
      unknown: `Gói đăng ký`,
      mochi: `Mochi`,
      dango: `Dango`,
      taiyaki: `Taiyaki`,
    },
    description: `Đăng ký hoặc liên kết tư cách thành viên Patreon để truy cập AI của TomoriBot.`,
    sponsorship: {
      errors: {
        title: `Tài trợ người ủng hộ không khả dụng`,
        billing_unavailable: `Thanh toán người ủng hộ không khả dụng trong môi trường này.`,
        unlinked: `Tài khoản Discord của bạn chưa được liên kết với danh tính người ủng hộ hợp lệ.`,
        inactive: `Tư cách thành viên người ủng hộ của bạn hiện không hoạt động.`,
        inconsistent: `Dữ liệu thanh toán người ủng hộ của bạn không đầy đủ ở cục bộ, do đó việc tài trợ bị tạm dừng cho đến khi dữ liệu được khắc phục.`,
        unconfigured_tier: `Gói người ủng hộ của bạn chưa được cấu hình để tài trợ máy chủ.`,
        exhausted: `Hạn mức người ủng hộ hiện tại của bạn đã hết trong chu kỳ này.`,
        missing_sponsorship: `Máy chủ này hiện không có tài trợ người ủng hộ đang hoạt động.`,
        model_not_allowed: `Model này không khả dụng cho quyền truy cập đăng ký. Hãy chọn model khác trong cài đặt nhà cung cấp.`,
        exhausted_generation: `Hạn mức đăng ký của máy chủ này đã hết. Hạn mức sẽ làm mới vào khoảng {period_end}. Người tài trợ có thể nâng cấp qua /subscribe. Bạn có thể dùng nhà cung cấp AI khác trong khi chờ: quản lý nhà cung cấp máy chủ bằng /providers hoặc nhà cung cấp cá nhân bằng /personal providers.`,
      },
    },
    callback: {
      success: {
        title: `Liên kết Patreon hoàn tất`,
        message: `Tài khoản người ủng hộ của bạn đã được liên kết. Hãy quay lại Discord và chọn Tiếp tục trong bảng thiết lập hoặc đăng ký để xem trạng thái cập nhật.`,
      },
      authorization_denied: {
        title: `Đã hủy liên kết Patreon`,
        message: `Patreon không ủy quyền cho liên kết này. Hãy quay lại Discord và chọn Tiếp tục trong bảng thiết lập hoặc đăng ký nếu bạn muốn thử lại.`,
      },
      missing_code: {
        title: `Liên kết Patreon thất bại`,
        message: `Phản hồi từ Patreon không chứa mã ủy quyền. Hãy quay lại Discord và thử lại /subscribe.`,
      },
      invalid_state: {
        title: `Liên kết Patreon thất bại`,
        message: `Trạng thái liên kết không hợp lệ. Hãy quay lại Discord và bắt đầu liên kết /subscribe mới.`,
      },
      expired_state: {
        title: `Liên kết Patreon đã hết hạn`,
        message: `Liên kết này đã hết hạn trước khi hoàn tất. Hãy quay lại Discord và bắt đầu liên kết /subscribe mới.`,
      },
      state_replay: {
        title: `Liên kết Patreon đã được sử dụng`,
        message: `Liên kết này đã được sử dụng hoặc không còn hiệu lực. Hãy quay lại Discord và bắt đầu liên kết /subscribe mới.`,
      },
      invalid_payload: {
        title: `Liên kết Patreon thất bại`,
        message: `Patreon đã trả về dữ liệu thành viên không đầy đủ. Hãy quay lại Discord và thử lại /subscribe sau.`,
      },
      unlinked_membership: {
        title: `Không có tư cách thành viên Patreon hợp lệ`,
        message: `Tài khoản Patreon này không được liên kết với tư cách thành viên hợp lệ. Hãy quay lại Discord và chọn Tiếp tục trong bảng thiết lập hoặc đăng ký.`,
      },
      wrong_campaign: {
        title: `Sai chiến dịch Patreon`,
        message: `Tư cách thành viên Patreon này không thuộc chiến dịch của người sáng tạo đã cấu hình. Chưa được cấp quyền truy cập người ủng hộ.`,
      },
      inactive: {
        title: `Tư cách thành viên Patreon không hoạt động`,
        message: `Tư cách thành viên Patreon này hiện không hoạt động hoặc chưa được hưởng quyền lợi. Chưa được cấp quyền truy cập người ủng hộ.`,
      },
      unconfigured_tier: {
        title: `Gói Patreon chưa được cấu hình`,
        message: `Gói Patreon này chưa được cấu hình cho quyền truy cập người ủng hộ. Chưa được cấp quyền truy cập người ủng hộ.`,
      },
      patreon_unavailable: {
        title: `Liên kết Patreon không khả dụng`,
        message: `Không thể kết nối đến Patreon hoặc nhận được phản hồi không hợp lệ. Hãy quay lại Discord và thử lại sau.`,
      },
      server_error: {
        title: `Liên kết Patreon thất bại`,
        message: `TomoriBot không thể hoàn tất liên kết. Hãy quay lại Discord và thử lại sau.`,
      },
    },
  },
};
